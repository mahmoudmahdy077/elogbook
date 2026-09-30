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
 * Entries are stored locally in AsyncStorage as a ring buffer (max 500) and
 * periodically flushed to the Supabase `audit_logs` table when the device is
 * online. The buffer is one AsyncStorage record per account AND session, so a
 * session can neither read another session's entries nor overwrite them; see
 * `bufferKeyForContext` for why that is not only about isolation.
 *
 * SECURITY: The audit log itself never stores raw PHI — only a SHA-256
 * digest of the accessed values. This satisfies the HIPAA requirement to
 * track access while minimizing the second-order risk of the log leaking PHI.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAccountContext, scopedKeyForContext, type AccountContext } from '../account-context';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

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

/**
 * Cached JSON text of `_buffer`, or `null` when it is not known to be current.
 *
 * The buffer is a whole-value AsyncStorage record, so every logged event has
 * to re-persist it. Re-running `JSON.stringify` over a buffer that grows to
 * 500 entries costs O(buffer) per event, which makes a burst of PHI reads
 * quadratic — on a device that is a full re-serialization of the ring, plus a
 * correspondingly large storage write, for every single access. Appending to
 * the cached text keeps the same durable record but costs O(1) amortised.
 *
 * The cache is only ever extended by `appendBufferEntry`. Every other
 * mutation goes through `setBuffer`, which drops it so the next persist
 * rebuilds the text from the buffer itself.
 */
let _serializedBuffer: string | null = null;

/**
 * Replace the ring buffer wholesale, discarding the incremental JSON cache.
 * All non-append mutations of `_buffer` must go through this.
 */
function setBuffer(next: AuditEntry[]): void {
  _buffer = next;
  _serializedBuffer = null;
}

/**
 * Append one entry to the ring buffer, extending the cached JSON text when it
 * is current. The resulting text is byte-identical to `JSON.stringify(_buffer)`.
 */
function appendBufferEntry(entry: AuditEntry): void {
  if (_serializedBuffer !== null) {
    // Drop the closing bracket and splice the new entry in ahead of it.
    const head = _serializedBuffer.slice(0, -1);
    const separator = _buffer.length > 0 ? ',' : '';
    _serializedBuffer = `${head}${separator}${JSON.stringify(entry)}]`;
  }
  _buffer.push(entry);
}

// ---------------------------------------------------------------------------
// AsyncStorage persistence helpers (N1: per-account, per-session scope — the
// buffer holds actor-bound entries and must never be readable across an account
// switch, and must never be overwritten by a later session of the same account).
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

/**
 * The AsyncStorage key for one session's ring buffer.
 *
 * The account (user + tenant) is the isolation boundary: a buffer of
 * actor-bound entries is never readable, or writable, under another account's
 * key, and the sign-out disposal in session-disposal.ts clears every key under
 * the account prefix, so this shape stays inside that purge.
 *
 * The session is in the key as well, and it is there for a reason that is not
 * isolation. The buffer is a whole-value record, so keyed by account alone a new
 * session -- a relaunch, a re-authentication, anything that is not a sign-out --
 * reads the record, finds none of its own entries, and writes its first event
 * straight over it. The previous session's undelivered accesses are then gone
 * with no record of the loss, and they were the only copy of a real PHI access
 * until they reached `audit_logs`. With the session in the key the overwrite is
 * impossible rather than unlikely: the prior record survives on disk under a key
 * this session cannot write, and it is never read into this session's view.
 */
function bufferKeyForContext(context: AccountContext): string {
  return `${context.userId}:${context.tenantId}:${context.sessionId ?? 'no-session'}:${STORAGE_KEY}`;
}

export function auditBufferKey(): string {
  const context = getAccountContext();
  if (!context) return `global:${STORAGE_KEY}`;
  return bufferKeyForContext(context);
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
    setBuffer([]);
    _loaded = true;
    _loadedScope = null;
    return _buffer;
  }
  const scope = scopeToken(context);
  if (_loaded && _loadedScope === scope) return _buffer;
  if (_loaded && _loadedScope !== scope) {
    setBuffer([]);
    _status = null;
  }
  _loadedScope = scope;
  const key = auditBufferKey();
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : [];
      const restored = values
        .map((value) => normalizeEntry(value, context))
        .filter((value): value is AuditEntry => value !== null
          && value.tenant_id === context.tenantId
          && value.user_id === context.userId
          && value.session_id === (context.sessionId ?? ''));
      setBuffer(restored.length > MAX_ENTRIES ? restored.slice(-MAX_ENTRIES) : restored);
    } else {
      setBuffer([]);
    }
  } catch {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) await AsyncStorage.setItem(`${key}.corrupt.${Date.now()}`, raw);
    } catch {
      logWarn('audit-trail.corrupt-backup-failed');
    }
    logWarn('audit-trail.corrupt-buffer-quarantined');
    setBuffer([]);
  }
  _loaded = true;
  return _buffer;
}

async function persistBuffer(): Promise<void> {
  const context = activeContext();
  if (_serializedBuffer === null) _serializedBuffer = JSON.stringify(_buffer);
  await AsyncStorage.setItem(bufferKeyForContext(context), _serializedBuffer);
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
  setBuffer([]);
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
    // Eviction drops the oldest entry, so the incremental JSON no longer
    // describes the buffer and has to be rebuilt on the next persist.
    _serializedBuffer = null;
  }
  appendBufferEntry(entry);
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
  setBuffer([]);
  _status = null;
  _loaded = false;
  _loadedScope = null;
  _statusScope = null;
  await AsyncStorage.removeItem(bufferKeyForContext(context));
  await AsyncStorage.removeItem(statusKey(context));
}

export async function clearAuditLog(): Promise<void> {
  const context = getAccountContext();
  if (context) {
    await clearAuditLogForContext(context);
    return;
  }
  setBuffer([]);
  _status = null;
  _loaded = false;
  _loadedScope = null;
  _statusScope = null;
  await AsyncStorage.removeItem(auditBufferKey());
  await AsyncStorage.removeItem(`global:${STATUS_KEY}`);
}

/**
 * Flush pending audit entries to the Supabase `audit_logs` table.
 *
 * The `audit_logs` INSERT policy only admits rows written from inside a
 * trigger (`pg_trigger_depth() >= 1`), so a direct
 * `supabase.from('audit_logs').insert(...)` from the app is always rejected
 * with 42501 and the required audit event is silently lost. Every entry is
 * delivered one at a time through the `write_audit_event` RPC, which is
 * authenticated, AAL checked, tenant pinned to the caller's own tenant and
 * metadata-only.
 *
 * Returns the number of entries successfully delivered. A failure keeps the
 * entry buffered (marked `failed`) so the next interval retries it; a partial
 * delivery keeps only the entries that succeeded.
 */
export async function flushAuditLog(): Promise<number> {
  const context = activeContext();
  const buffer = await loadBuffer();
  const entries = buffer.filter((entry) =>
    entry.tenant_id === context.tenantId
    && entry.user_id === context.userId
    && entry.session_id === (context.sessionId ?? ''));
  if (entries.length === 0) return 0;

  const delivered = new Set<AuditEntry>();
  let lastError: unknown = null;

  for (const entry of entries) {
    // audit_logs.resource_id is a uuid. A legacy row key that is not one is
    // recorded as a metadata-only event attributed to the tenant row rather
    // than dropped or coerced.
    const resourceId = isUuid(entry.resource_id) ? entry.resource_id : null;
    const resourceType = resourceId === null ? 'mobile_buffer' : entry.resource_type;

    try {
      const { data, error } = await supabase.rpc('write_audit_event', {
        p_action: entry.action,
        p_resource_type: resourceType,
        p_resource_id: resourceId,
        p_changes: entry.changes,
        p_tenant_id: entry.tenant_id,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== 'string' || data.length === 0) throw new Error('audit write rejected');
      delivered.add(entry);
    } catch (error) {
      lastError = error;
    }
  }

  if (delivered.size > 0) {
    // The live buffer, not the array this flush read when it started. Delivery
    // is a round trip, so anything logged in the meantime is in `_buffer` and
    // not in the captured copy: writing the captured one back would discard a
    // real PHI access that exists nowhere else. Removing the delivered entries
    // by identity from whatever is there now touches only what was delivered.
    setBuffer(_buffer.filter((entry) => !delivered.has(entry)));
    try {
      await persistBuffer();
    } catch (storageError) {
      _status = {
        ...(await loadStatus()),
        storageUnavailable: true,
        lastError: safeErrorMessage(storageError),
      };
      await persistStatus();
      return 0;
    }
  }

  if (lastError !== null) {
    const message = safeErrorMessage(lastError);
    const failed = new Set(entries.filter((entry) => !delivered.has(entry)));
    setBuffer(_buffer.map((entry) => failed.has(entry)
      ? { ...entry, delivery_state: 'failed' as const, attempts: entry.attempts + 1, last_error: message }
      : entry));
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
    return delivered.size;
  }

  await updateStatus({
    pending: _buffer.filter((entry) => entry.delivery_state === 'pending').length,
    failed: _buffer.filter((entry) => entry.delivery_state === 'failed').length,
    lastError: null,
    lastFailureAt: null,
    lastSuccessAt: Date.now(),
    storageUnavailable: false,
  });
  return delivered.size;
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
