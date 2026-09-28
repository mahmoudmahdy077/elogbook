/**
 * HIPAA Audit Trail for PHI Access.
 *
 * Every read/write of patient-identifiable data is logged with a tenant,
 * profile/session-scoped actor, resource metadata, and a one-way hash.
 *   - ISO-8601 timestamp
 *   - authenticated user_id
 *   - action (read | create | update | delete)
 *   - table and row_id
 *   - one-way SHA-256 hash of the accessed data snapshot
 *
 * Entries are stored locally in AsyncStorage as a ring buffer (max 500)
 * and periodically flushed to the Supabase `audit_logs` table when the
 * device is online.
 *
 * SECURITY: The audit log itself never stores raw PHI — only a SHA-256
 * digest of the accessed values. This satisfies the HIPAA requirement to
 * track access while minimizing the second-order risk of the log leaking PHI.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAccountContext, scopedKey, scopedKeyForContext, type AccountContext } from '../account-context';
import { logWarn } from '../logger';
import { supabase } from '../supabase';
import { sha256, bytesToHex } from '../crypto/sha256';
import { getRoleFromAuth } from '../auth-guard';
import type { UserRole } from '@elogbook/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditAction = 'read' | 'create' | 'update' | 'delete';
export type AuditDeliveryState = 'pending' | 'failed';

export interface AuditEntry {
  timestamp: string;
  tenant_id: string;
  user_id: string;
  session_id: string;
  action: AuditAction;
  table: string;
  row_id: string;
  data_hash: string;
  resource_type: string;
  resource_id: string;
  changes: Record<string, unknown>;
  delivery_state: AuditDeliveryState;
  attempts: number;
  last_error: string | null;
}

export interface AuditDeliveryStatus {
  pending: number;
  failed: number;
  lastError: string | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  storageUnavailable: boolean;
  dropped: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'audit_trail_buffer_v1';
const STATUS_KEY = 'audit_trail_status_v1';
const MAX_ENTRIES = 500;
const FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const SUPABASE_TABLE = 'audit_logs';

/**
 * Roles permitted to view or edit PHI per institutional policy.
 * Only residents, supervisors, and directors handle patient-identifiable data.
 */
const PHI_ROLES: UserRole[] = ['resident', 'supervisor', 'director'];

// ---------------------------------------------------------------------------
// Internal ring-buffer state
// ---------------------------------------------------------------------------

let _buffer: AuditEntry[] = [];
let _loaded = false;
let _loadedScope: string | null = null;
let _status: AuditDeliveryStatus | null = null;
let _statusScope: string | null = null;
let _flushTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// AsyncStorage persistence helpers (N1: per-account scope — the buffer holds
// actor-bound entries and must never be readable across account switch).
// ---------------------------------------------------------------------------

function activeContext(): AccountContext {
  const context = getAccountContext();
  if (!context) throw new Error('[audit-trail] active account context required');
  if ((context.status && context.status !== 'active') || (context.tenantStatus && context.tenantStatus !== 'active')) {
    throw new Error('[audit-trail] inactive account or tenant scope');
  }
  if (context.expiresAt !== undefined && context.expiresAt !== null && context.expiresAt <= Date.now()) {
    throw new Error('[audit-trail] expired session scope');
  }
  return context;
}

export function auditBufferKey(): string {
  return scopedKey(STORAGE_KEY);
}

function scopeToken(context: AccountContext): string {
  return `${context.userId}:${context.tenantId}:${context.profileId}:${context.sessionId ?? 'no-session'}`;
}

function statusKey(context: AccountContext): string {
  return scopedKeyForContext(context, STATUS_KEY);
}

function emptyStatus(): AuditDeliveryStatus {
  return {
    pending: 0,
    failed: 0,
    lastError: null,
    lastFailureAt: null,
    lastSuccessAt: null,
    storageUnavailable: false,
    dropped: 0,
  };
}

function normalizeEntry(value: unknown, context: AccountContext): AuditEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const action = raw.action;
  if (action !== 'read' && action !== 'create' && action !== 'update' && action !== 'delete') return null;
  const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString();
  const dataHash = typeof raw.data_hash === 'string' ? raw.data_hash : '';
  const resourceType = typeof raw.resource_type === 'string' ? raw.resource_type : typeof raw.table === 'string' ? raw.table : '';
  const resourceId = typeof raw.resource_id === 'string' ? raw.resource_id : typeof raw.row_id === 'string' ? raw.row_id : '';
  if (!resourceType || !resourceId || !dataHash) return null;
  const changes = { data_hash: dataHash };
  const tenantId = typeof raw.tenant_id === 'string' ? raw.tenant_id : context.tenantId;
  const userId = typeof raw.user_id === 'string' ? raw.user_id : context.userId;
  return {
    timestamp,
    tenant_id: tenantId,
    user_id: userId,
    session_id: typeof raw.session_id === 'string' ? raw.session_id : '',
    action,
    table: typeof raw.table === 'string' ? raw.table : resourceType,
    row_id: typeof raw.row_id === 'string' ? raw.row_id : resourceId,
    data_hash: dataHash,
    resource_type: resourceType,
    resource_id: resourceId,
    changes,
    delivery_state: raw.delivery_state === 'failed' ? 'failed' : 'pending',
    attempts: typeof raw.attempts === 'number' && Number.isFinite(raw.attempts) ? raw.attempts : 0,
    last_error: typeof raw.last_error === 'string' ? safeErrorMessage(raw.last_error) : null,
  };
}

async function loadBuffer(): Promise<AuditEntry[]> {
  const context = getAccountContext();
  if (!context) {
    _buffer = [];
    _loaded = true;
    _loadedScope = null;
    return _buffer;
  }
  const scope = scopeToken(context);
  if (_loaded && _loadedScope === scope) return _buffer;
  if (_loaded && _loadedScope !== scope) {
    _buffer = [];
    _status = null;
  }
  _loadedScope = scope;
  const key = auditBufferKey();
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : [];
      _buffer = values
        .map((value) => normalizeEntry(value, context))
        .filter((value): value is AuditEntry => value !== null
          && value.tenant_id === context.tenantId
          && value.user_id === context.userId
          && value.session_id === (context.sessionId ?? ''));
      if (_buffer.length > MAX_ENTRIES) _buffer = _buffer.slice(-MAX_ENTRIES);
    } else {
      _buffer = [];
    }
  } catch {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) await AsyncStorage.setItem(`${key}.corrupt.${Date.now()}`, raw);
    } catch {
      logWarn('audit-trail.corrupt-backup-failed');
    }
    logWarn('audit-trail.corrupt-buffer-quarantined');
    _buffer = [];
  }
  _loaded = true;
  return _buffer;
}

async function persistBuffer(): Promise<void> {
  const context = activeContext();
  await AsyncStorage.setItem(scopedKeyForContext(context, STORAGE_KEY), JSON.stringify(_buffer));
}

async function loadStatus(): Promise<AuditDeliveryStatus> {
  const context = activeContext();
  const scope = scopeToken(context);
  if (_status && _statusScope === scope) return _status;
  if (_status && _statusScope !== scope) _status = null;
  _statusScope = scope;
  try {
    const raw = await AsyncStorage.getItem(statusKey(context));
    const parsed = raw ? JSON.parse(raw) as Partial<AuditDeliveryStatus> : {};
    _status = { ...emptyStatus(), ...parsed, storageUnavailable: false };
  } catch {
    _status = { ...emptyStatus(), storageUnavailable: true };
  }
  return _status;
}

async function persistStatus(): Promise<void> {
  const context = activeContext();
  if (!_status) return;
  try {
    await AsyncStorage.setItem(statusKey(context), JSON.stringify(_status));
  } catch {
    _status.storageUnavailable = true;
  }
}

async function updateStatus(update: Partial<AuditDeliveryStatus>): Promise<void> {
  const status = await loadStatus();
  _status = { ...status, ...update };
  await persistStatus();
}

export function disposeAuditBuffer(): void {
  stopAuditFlush();
  _buffer = [];
  _status = null;
  _loaded = false;
  _loadedScope = null;
  _statusScope = null;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Produce a one-way SHA-256 hex digest of arbitrary PHI data.
 * Objects are JSON-serialized before hashing so the digest is stable.
 */
function hashData(data: unknown): string {
  const serialised =
    data === null || data === undefined
      ? 'null'
      : typeof data === 'string'
        ? data
        : JSON.stringify(data);
  const encoded = new TextEncoder().encode(serialised);
  const digest = sha256(encoded);
  return bytesToHex(digest);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/network|fetch|timeout|connect|offline/i.test(message)) return 'network: audit delivery unavailable';
  if (/401|403|auth|jwt|rls|permission|policy/i.test(message)) return 'auth: audit delivery rejected';
  if (/relation|column|schema|contract/i.test(message)) return 'schema: audit delivery rejected';
  return 'audit delivery failed';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Log a PHI access event. The data snapshot is hashed before storage —
 * raw PHI is never persisted in the audit log.
 */
export async function logAuditEvent(params: {
  userId: string;
  action: AuditAction;
  table: string;
  rowId: string;
  data: unknown;
}): Promise<void> {
  const context = activeContext();
  const dataHash = hashData(params.data);
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    tenant_id: context.tenantId,
    user_id: context.userId,
    session_id: context.sessionId ?? '',
    action: params.action,
    table: params.table,
    row_id: params.rowId,
    data_hash: dataHash,
    resource_type: params.table,
    resource_id: params.rowId,
    changes: { data_hash: dataHash },
    delivery_state: 'pending',
    attempts: 0,
    last_error: null,
  };

  const buffer = await loadBuffer();
  if (buffer.length >= MAX_ENTRIES) {
    const status = await loadStatus();
    _status = { ...status, dropped: status.dropped + 1, lastError: 'audit queue full; oldest entry evicted' };
    await persistStatus();
    buffer.shift();
  }
  buffer.push(entry);
  _buffer = buffer;
  try {
    await persistBuffer();
    await updateStatus({ pending: _buffer.length, failed: _buffer.filter((item) => item.delivery_state === 'failed').length });
  } catch (error) {
    await updateStatus({ storageUnavailable: true, lastError: safeErrorMessage(error) });
    throw error;
  }
}

/**
 * Retrieve recent audit log entries (most recent last).
 * @param limit Max entries to return. Defaults to 50.
 */
export async function getAuditLog(limit: number = 50): Promise<AuditEntry[]> {
  const buffer = await loadBuffer();
  return buffer.slice(-limit);
}

/**
 * Export the full audit log as a JSON string for HIPAA compliance audits.
 * Returns a JSON string (not an object) so it can be written to a file
 * or transmitted as-is.
 */
export async function exportAuditLog(): Promise<string> {
  const buffer = await loadBuffer();
  return JSON.stringify(buffer, null, 2);
}

/**
 * Clear the local audit log. Called on logout to prevent cross-user
 * data leakage on shared devices.
 */
export async function getAuditDeliveryStatus(): Promise<AuditDeliveryStatus> {
  const buffer = await loadBuffer();
  const status = await loadStatus();
  return {
    ...status,
    pending: buffer.filter((entry) => entry.delivery_state === 'pending').length,
    failed: buffer.filter((entry) => entry.delivery_state === 'failed').length,
  };
}

export async function clearAuditLogForContext(context: AccountContext): Promise<void> {
  _buffer = [];
  _status = null;
  _loaded = false;
  _loadedScope = null;
  _statusScope = null;
  await AsyncStorage.removeItem(scopedKeyForContext(context, STORAGE_KEY));
  await AsyncStorage.removeItem(statusKey(context));
}

export async function clearAuditLog(): Promise<void> {
  const context = getAccountContext();
  if (context) {
    await clearAuditLogForContext(context);
    return;
  }
  _buffer = [];
  _status = null;
  _loaded = false;
  _loadedScope = null;
  _statusScope = null;
  await AsyncStorage.removeItem(auditBufferKey());
  await AsyncStorage.removeItem(`global:${STATUS_KEY}`);
}

/**
 * Flush pending audit entries to the Supabase `audit_logs` table.
 * Only uploads entries that haven't been confirmed yet (tracked via
 * a local flag). Operates in batches to respect network constraints.
 *
 * Returns the number of entries successfully flushed.
 */
export async function flushAuditLog(): Promise<number> {
  const context = activeContext();
  const buffer = await loadBuffer();
  const entries = buffer.filter((entry) =>
    entry.tenant_id === context.tenantId
    && entry.user_id === context.userId
    && entry.session_id === (context.sessionId ?? ''));
  if (entries.length === 0) return 0;

  const serverRows = entries.map((entry) => ({
    tenant_id: entry.tenant_id,
    user_id: entry.user_id,
    action: entry.action,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id,
    changes: entry.changes,
  }));

  try {
    const { error } = await supabase.from(SUPABASE_TABLE).insert(serverRows);
    if (error) throw new Error(error.message);
    _buffer = buffer.filter((entry) => !entries.includes(entry));
    try {
      await persistBuffer();
    } catch (storageError) {
      _status = {
        ...(await loadStatus()),
        storageUnavailable: true,
        lastError: safeErrorMessage(storageError),
      };
      await persistStatus();
      throw storageError;
    }
    await updateStatus({
      pending: _buffer.filter((entry) => entry.delivery_state === 'pending').length,
      failed: _buffer.filter((entry) => entry.delivery_state === 'failed').length,
      lastError: null,
      lastFailureAt: null,
      lastSuccessAt: Date.now(),
      storageUnavailable: false,
    });
    return entries.length;
  } catch (error) {
    const message = safeErrorMessage(error);
    const failedEntries = new Set(entries);
    _buffer = buffer.map((entry) => failedEntries.has(entry)
      ? { ...entry, delivery_state: 'failed' as const, attempts: entry.attempts + 1, last_error: message }
      : entry);
    try {
      await persistBuffer();
    } catch (storageError) {
      _status = {
        ...(await loadStatus()),
        storageUnavailable: true,
        lastError: safeErrorMessage(storageError),
      };
    }
    await updateStatus({
      pending: _buffer.filter((entry) => entry.delivery_state === 'pending').length,
      failed: _buffer.filter((entry) => entry.delivery_state === 'failed').length,
      lastError: message,
      lastFailureAt: Date.now(),
    });
    logWarn('audit-trail.flush-failed', { error: message });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Periodic flush (background sync)
// ---------------------------------------------------------------------------

/**
 * Start the periodic flush timer. When the device is online, audit entries
 * are pushed to Supabase every FLUSH_INTERVAL_MS milliseconds.
 * Safe to call multiple times — extra calls are no-ops.
 */
export function startAuditFlush(): void {
  if (_flushTimer !== null) return;

  _flushTimer = setInterval(async () => {
    try {
      // Quick connectivity check via Supabase auth (lightweight, no extra dep)
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) {
        await updateStatus({ lastError: 'audit delivery unavailable: no authenticated session' });
        return;
      }

      const count = await flushAuditLog();
      if (count > 0 && __DEV__) {
        console.debug(`[AuditTrail] Flushed ${count} entries to ${SUPABASE_TABLE}`);
      }
    } catch (error) {
      await updateStatus({ lastError: safeErrorMessage(error) });
    }
  }, FLUSH_INTERVAL_MS);
}

/**
 * Stop the periodic flush timer. Call on logout or app background.
 */
export function stopAuditFlush(): void {
  if (_flushTimer !== null) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
}

// ---------------------------------------------------------------------------
// PHI role-gate
// ---------------------------------------------------------------------------

/**
 * Check whether the currently authenticated user has a role that permits
 * PHI (Protected Health Information) access.
 *
 * Only `resident`, `supervisor`, and `director` roles are authorized.
 * Returns `{ allowed: boolean, role: UserRole | null }`.
 */
export async function canAccessPHI(): Promise<{
  allowed: boolean;
  role: UserRole | null;
}> {
  try {
    const { role } = await getRoleFromAuth();
    return {
      allowed: role !== null && PHI_ROLES.includes(role),
      role,
    };
  } catch {
    return { allowed: false, role: null };
  }
}

// ---------------------------------------------------------------------------
// Utility: log PHI read (convenience wrapper)
// ---------------------------------------------------------------------------

/**
 * Log a read access to PHI fields on a specific row.
 * Intended to be called from data-access.ts after decryption.
 */
export async function logPhiRead(params: {
  userId: string;
  table: string;
  rowId: string;
  phiFields: Record<string, unknown>;
}): Promise<void> {
  return logAuditEvent({
    userId: params.userId,
    action: 'read',
    table: params.table,
    rowId: params.rowId,
    data: params.phiFields,
  });
}

/**
 * Log a write (create/update/delete) access to PHI fields.
 */
export async function logPhiWrite(params: {
  userId: string;
  action: 'create' | 'update' | 'delete';
  table: string;
  rowId: string;
  phiFields: Record<string, unknown>;
}): Promise<void> {
  return logAuditEvent({
    userId: params.userId,
    action: params.action,
    table: params.table,
    rowId: params.rowId,
    data: params.phiFields,
  });
}
