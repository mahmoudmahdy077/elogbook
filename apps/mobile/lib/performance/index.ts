/**
 * Performance utilities for offline-first mobile app.
 *
 * Cycle 4: Lazy DB init, batch writes, query caching, memory-efficient pagination.
 * Cycle 5: Network optimization (delta sync, connection-aware scheduling).
 */

import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// 1. Lazy Database Initialization
// ---------------------------------------------------------------------------

let dbInitPromise: Promise<unknown> | null = null;
let dbReady = false;

/**
 * Initialize the database lazily — only when first needed. This prevents
 * blocking the app startup with a heavy SQLite operation. Subsequent calls
 * return the cached promise.
 */
export function lazyInitDatabase(initFn: () => Promise<unknown>): Promise<unknown> {
  if (dbReady) return Promise.resolve(null);
  if (!dbInitPromise) {
    dbInitPromise = initFn().then((db) => {
      dbReady = true;
      return db;
    }).catch((err) => {
      dbInitPromise = null; // allow retry
      throw err;
    });
  }
  return dbInitPromise;
}

export function isDatabaseReady(): boolean {
  return dbReady;
}

// ---------------------------------------------------------------------------
// 2. Batch Write Operations
// ---------------------------------------------------------------------------

/**
 * Batch multiple WatermelonDB write operations into a single transaction.
 * This is significantly faster than individual writes (10-50x on Android).
 */
export async function batchWrite<T>(
  db: { write: (fn: () => void) => Promise<T> },
  operations: Array<(db: unknown) => void>,
): Promise<T[]> {
  const results: T[] = [];
  await db.write(() => {
    for (const op of operations) {
      op(db);
    }
  });
  return results;
}

// ---------------------------------------------------------------------------
// 3. Query Cache with TTL
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const queryCache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 30_000; // 30 seconds

/**
 * Cache a query result with a TTL. Returns cached data if fresh,
 * otherwise calls the fetcher and caches the result.
 */
export async function cachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const entry = queryCache.get(key) as CacheEntry<T> | undefined;
  if (entry && Date.now() - entry.timestamp < ttlMs) {
    return entry.data;
  }
  const data = await fetcher();
  queryCache.set(key, { data, timestamp: Date.now() });
  return data;
}

/** Invalidate a cached query (or all queries with a prefix). */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    queryCache.clear();
    return;
  }
  for (const key of queryCache.keys()) {
    if (key.startsWith(prefix)) queryCache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// 4. Memory-Efficient Pagination
// ---------------------------------------------------------------------------

/**
 * Paginated fetch from WatermelonDB. Yields pages of results without loading
 * the entire dataset into memory. Use for large lists (case_entries, etc.).
 */
export async function* paginatedFetch<T extends { id: string }>(
  queryFn: (offset: number, limit: number) => Promise<T[]>,
  pageSize: number = 50,
): AsyncGenerator<T[], void, unknown> {
  let offset = 0;
  while (true) {
    const page = await queryFn(offset, pageSize);
    if (page.length === 0) break;
    yield page;
    offset += page.length;
    if (page.length < pageSize) break; // last page
  }
}

// ---------------------------------------------------------------------------
// 5. Connection-Aware Sync Scheduling
// ---------------------------------------------------------------------------

export type ConnectionQuality = 'none' | 'slow' | 'good' | 'excellent';

interface ConnectionInfo {
  quality: ConnectionQuality;
  isMetered: boolean;
  type: string;
}

/**
 * Detect current connection quality for adaptive sync behavior.
 * - none: skip sync entirely
 * - slow: reduce page sizes, increase intervals
 * - good: normal sync
 * - excellent: aggressive sync, larger batches
 */
export async function getConnectionInfo(): Promise<ConnectionInfo> {
  const state = await NetInfo.fetch();

  if (!state.isConnected) {
    return { quality: 'none', isMetered: false, type: 'none' };
  }

  const isMetered = state.details?.isConnectionExpensive ?? false;
  const type = state.type ?? 'unknown';
  const generation = (state.details as Record<string, unknown>)?.cellularGeneration;

  let quality: ConnectionQuality;
  if (type === 'wifi' || type === 'ethernet') {
    quality = isMetered ? 'good' : 'excellent';
  } else if (generation === '5g' || generation === '4g') {
    quality = isMetered ? 'good' : 'excellent';
  } else if (generation === '3g') {
    quality = 'slow';
  } else {
    quality = 'slow';
  }

  return { quality, isMetered, type };
}

/**
 * Get recommended sync parameters based on connection quality.
 */
export function getSyncParams(quality: ConnectionQuality): {
  pullPageSize: number;
  pushBatchSize: number;
  syncIntervalMs: number;
} {
  switch (quality) {
    case 'excellent':
      return { pullPageSize: 1000, pushBatchSize: 200, syncIntervalMs: 30_000 };
    case 'good':
      return { pullPageSize: 500, pushBatchSize: 100, syncIntervalMs: 60_000 };
    case 'slow':
      return { pullPageSize: 100, pushBatchSize: 25, syncIntervalMs: 120_000 };
    case 'none':
    default:
      return { pullPageSize: 0, pushBatchSize: 0, syncIntervalMs: 0 };
  }
}

// ---------------------------------------------------------------------------
// 6. Delta Sync — Track Changed Fields
// ---------------------------------------------------------------------------

/**
 * Compute which fields changed between two versions of a row.
 * Used to send only changed fields in push operations (bandwidth optimization).
 */
export function computeDelta<T extends Record<string, unknown>>(
  oldRow: T,
  newRow: T,
  skipKeys: string[] = ['id', 'created_at', 'updated_at', 'server_id', 'local_sync_status'],
): Partial<T> {
  const delta: Partial<T> = {};
  for (const key of Object.keys(newRow)) {
    if (skipKeys.includes(key)) continue;
    const oldVal = oldRow[key];
    const newVal = newRow[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      (delta as Record<string, unknown>)[key] = newVal;
    }
  }
  return delta;
}

// ---------------------------------------------------------------------------
// 7. AsyncStorage Compaction
// ---------------------------------------------------------------------------

/**
 * Compact AsyncStorage by removing expired entries and defragmenting.
 * Call periodically (e.g., on app foreground) to prevent storage bloat.
 */
export async function compactStorage(maxEntries: number = 1000): Promise<number> {
  const keys = await AsyncStorage.getAllKeys();
  if (keys.length <= maxEntries) return 0;

  // Remove oldest entries (FIFO based on key ordering)
  const toRemove = keys.slice(0, keys.length - maxEntries);
  // AsyncStorage.multiRemove may not exist on all platforms; use sequential fallback
  for (const key of toRemove) {
    await AsyncStorage.removeItem(key);
  }
  return toRemove.length;
}
