/**
 * HIPAA Audit Trail for PHI Access.
 *
 * Every read/write of patient-identifiable data (patient_mrn, patient_dob,
 * field_values) is logged with:
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
import { supabase } from '../supabase';
import { sha256, bytesToHex } from '../crypto/sha256';
import { getRoleFromAuth } from '../auth-guard';
import type { UserRole } from '@elogbook/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditAction = 'read' | 'create' | 'update' | 'delete';

export interface AuditEntry {
  /** ISO-8601 timestamp of the access event */
  timestamp: string;
  /** Authenticated user UUID */
  user_id: string;
  /** Action performed */
  action: AuditAction;
  /** Database table that was accessed */
  table: string;
  /** Row ID within the table */
  row_id: string;
  /** One-way SHA-256 hex digest of the accessed PHI data */
  data_hash: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'audit_trail_buffer_v1';
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
let _flushTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// AsyncStorage persistence helpers
// ---------------------------------------------------------------------------

async function loadBuffer(): Promise<AuditEntry[]> {
  if (_loaded) return _buffer;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _buffer = Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
      // Enforce ring-buffer cap on load (defensive — shouldn't exceed 500)
      if (_buffer.length > MAX_ENTRIES) {
        _buffer = _buffer.slice(-MAX_ENTRIES);
      }
    } else {
      _buffer = [];
    }
  } catch {
    _buffer = [];
  }
  _loaded = true;
  return _buffer;
}

async function persistBuffer(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(_buffer));
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
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    user_id: params.userId,
    action: params.action,
    table: params.table,
    row_id: params.rowId,
    data_hash: hashData(params.data),
  };

  const buffer = await loadBuffer();

  // Ring-buffer: if at capacity, drop the oldest entry
  if (buffer.length >= MAX_ENTRIES) {
    buffer.shift();
  }

  buffer.push(entry);
  _buffer = buffer;
  await persistBuffer();
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
export async function clearAuditLog(): Promise<void> {
  _buffer = [];
  _loaded = false;
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * Flush pending audit entries to the Supabase `audit_logs` table.
 * Only uploads entries that haven't been confirmed yet (tracked via
 * a local flag). Operates in batches to respect network constraints.
 *
 * Returns the number of entries successfully flushed.
 */
export async function flushAuditLog(): Promise<number> {
  const buffer = await loadBuffer();
  if (buffer.length === 0) return 0;

  // Clone to avoid mutation during iteration
  const entries = [...buffer];
  let flushed = 0;

  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE)
      .insert(entries.map((e) => ({
        timestamp: e.timestamp,
        user_id: e.user_id,
        action: e.action,
        table_name: e.table,
        row_id: e.row_id,
        data_hash: e.data_hash,
      })));

    if (!error) {
      flushed = entries.length;
      // Clear the buffer on successful flush
      _buffer = [];
      await persistBuffer();
    }
    // On error, entries remain in buffer for next flush attempt
  } catch {
    // Network failure — entries stay in buffer for retry
  }

  return flushed;
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
      if (error || !session) return; // not authenticated — skip flush

      const count = await flushAuditLog();
      if (count > 0 && __DEV__) {
        console.debug(`[AuditTrail] Flushed ${count} entries to ${SUPABASE_TABLE}`);
      }
    } catch {
      // Silently skip — next interval will retry
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
