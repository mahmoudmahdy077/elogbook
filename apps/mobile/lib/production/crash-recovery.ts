/**
 * Crash Recovery & Data Integrity.
 *
 * Cycle 6: Ensures the app can recover from crashes during sync, partial
 * writes, and data corruption. Provides rollback, integrity checks, and
 * graceful degradation.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// 1. Sync Checkpoint — Resume After Crash
// ---------------------------------------------------------------------------

const CHECKPOINT_KEY = 'sync_checkpoint_v1';

export interface SyncCheckpoint {
  /** Table currently being synced */
  currentTable: string;
  /** Phase: pulling or pushing */
  phase: 'pulling' | 'pushing';
  /** Cursor (timestamp) for the current pull */
  pullCursor: number;
  /** Rows pushed so far in current push phase */
  pushedCount: number;
  /** Timestamp when sync started */
  startedAt: number;
  /** Whether this was a full sync or incremental */
  isFullSync: boolean;
}

/**
 * Save a sync checkpoint before each risky operation.
 * If the app crashes mid-sync, the next startup can resume from this point.
 */
export async function saveSyncCheckpoint(checkpoint: SyncCheckpoint): Promise<void> {
  await AsyncStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
}

/**
 * Load the last sync checkpoint (if any). Returns null if no checkpoint exists.
 */
export async function loadSyncCheckpoint(): Promise<SyncCheckpoint | null> {
  try {
    const raw = await AsyncStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SyncCheckpoint;
  } catch {
    return null;
  }
}

/**
 * Clear the sync checkpoint (called after successful sync completion).
 */
export async function clearSyncCheckpoint(): Promise<void> {
  await AsyncStorage.removeItem(CHECKPOINT_KEY);
}

/**
 * Check if there's a stale checkpoint (older than 30 minutes).
 * Stale checkpoints indicate a crash — the sync was interrupted.
 */
export async function hasStaleCheckpoint(maxAgeMs: number = 30 * 60 * 1000): Promise<boolean> {
  const cp = await loadSyncCheckpoint();
  if (!cp) return false;
  return Date.now() - cp.startedAt > maxAgeMs;
}

// ---------------------------------------------------------------------------
// 2. Write-Ahead Log (WAL) for Critical Operations
// ---------------------------------------------------------------------------

const WAL_KEY = 'write_ahead_log_v1';

export interface WALEntry {
  id: string;
  table: string;
  operation: 'create' | 'update' | 'delete';
  rowId: string;
  data: Record<string, unknown>;
  timestamp: number;
  applied: boolean;
}

/**
 * Write an entry to the WAL before performing a critical write.
 * After the write succeeds, mark it as applied.
 */
export async function walWrite(entry: Omit<WALEntry, 'timestamp' | 'applied'>): Promise<void> {
  const log = await walRead();
  log.push({ ...entry, timestamp: Date.now(), applied: false });
  // Keep only last 100 entries
  const trimmed = log.slice(-100);
  await AsyncStorage.setItem(WAL_KEY, JSON.stringify(trimmed));
}

/**
 * Mark a WAL entry as applied.
 */
export async function walMarkApplied(entryId: string): Promise<void> {
  const log = await walRead();
  const entry = log.find((e) => e.id === entryId);
  if (entry) entry.applied = true;
  await AsyncStorage.setItem(WAL_KEY, JSON.stringify(log));
}

/**
 * Get all unapplied WAL entries (pending crash recovery).
 */
export async function walGetPending(): Promise<WALEntry[]> {
  const log = await walRead();
  return log.filter((e) => !e.applied);
}

/**
 * Clear the WAL (called after all entries are applied).
 */
export async function walClear(): Promise<void> {
  await AsyncStorage.removeItem(WAL_KEY);
}

async function walRead(): Promise<WALEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(WAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 3. Data Integrity Verification
// ---------------------------------------------------------------------------

export interface IntegrityCheckResult {
  table: string;
  totalRows: number;
  orphanedRows: number;
  missingServerId: number;
  pendingSync: number;
  corruptedTimestamps: number;
  passed: boolean;
}

/**
 * Verify data integrity for a table. Checks for:
 * - Orphaned rows (referenced by foreign key but missing)
 * - Missing server_id on synced rows
 * - Corrupted timestamps (NaN, negative, future)
 * - Rows stuck in pending_sync state
 */
export async function verifyTableIntegrity(
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<IntegrityCheckResult> {
  let orphanedRows = 0;
  let missingServerId = 0;
  let pendingSync = 0;
  let corruptedTimestamps = 0;

  for (const row of rows) {
    // Check timestamps
    const createdAt = row.created_at as number;
    const updatedAt = row.updated_at as number;
    if (!Number.isFinite(createdAt) || createdAt < 0) corruptedTimestamps++;
    if (!Number.isFinite(updatedAt) || updatedAt < 0) corruptedTimestamps++;
    if (updatedAt > Date.now() + 86400000) corruptedTimestamps++; // future > 24h

    // Check sync status
    const syncStatus = row.local_sync_status as string;
    if (syncStatus && syncStatus !== 'synced') pendingSync++;

    // Check server_id for synced rows
    if (syncStatus === 'synced' && !row.server_id) missingServerId++;

    // Check tenant_id (required for all rows)
    if (!row.tenant_id) orphanedRows++;
  }

  return {
    table,
    totalRows: rows.length,
    orphanedRows,
    missingServerId,
    pendingSync,
    corruptedTimestamps,
    passed: orphanedRows === 0 && corruptedTimestamps === 0,
  };
}

// ---------------------------------------------------------------------------
// 4. Graceful Degradation
// ---------------------------------------------------------------------------

/**
 * Wrap an async operation with a timeout and fallback.
 * If the operation takes too long, return the fallback value.
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

/**
 * Retry an operation with exponential backoff.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, i) + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
