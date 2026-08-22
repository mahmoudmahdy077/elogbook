import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AsyncStorage
vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      getAllKeys: async () => Array.from(store.keys()),
      multiRemove: async (keys: string[]) => keys.forEach((k) => store.delete(k)),
    },
  };
});

// Mock crypto.randomUUID
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: () => 'test-uuid-1234' },
});

import {
  saveSyncCheckpoint, loadSyncCheckpoint, clearSyncCheckpoint, hasStaleCheckpoint,
  walWrite, walMarkApplied, walGetPending, walClear,
  verifyTableIntegrity,
  withTimeout, withRetry,
} from '../crash-recovery';

describe('crash-recovery', () => {
  beforeEach(async () => {
    await clearSyncCheckpoint();
    await walClear();
  });

  describe('sync checkpoint', () => {
    it('saves and loads a checkpoint', async () => {
      await saveSyncCheckpoint({
        currentTable: 'case_entries', phase: 'pulling', pullCursor: 1000,
        pushedCount: 5, startedAt: Date.now(), isFullSync: false,
      });
      const cp = await loadSyncCheckpoint();
      expect(cp).not.toBeNull();
      expect(cp!.currentTable).toBe('case_entries');
      expect(cp!.pullCursor).toBe(1000);
    });

    it('returns null when no checkpoint', async () => {
      expect(await loadSyncCheckpoint()).toBeNull();
    });

    it('clears checkpoint', async () => {
      await saveSyncCheckpoint({
        currentTable: 'case_entries', phase: 'pulling', pullCursor: 1000,
        pushedCount: 5, startedAt: Date.now(), isFullSync: false,
      });
      await clearSyncCheckpoint();
      expect(await loadSyncCheckpoint()).toBeNull();
    });

    it('detects stale checkpoint', async () => {
      await saveSyncCheckpoint({
        currentTable: 'case_entries', phase: 'pulling', pullCursor: 1000,
        pushedCount: 5, startedAt: Date.now() - 60 * 60 * 1000, // 1 hour ago
        isFullSync: false,
      });
      expect(await hasStaleCheckpoint()).toBe(true);
    });
  });

  describe('write-ahead log', () => {
    it('writes and reads WAL entries', async () => {
      await walWrite({ id: 'e1', table: 'case_entries', operation: 'create', rowId: 'r1', data: {} });
      const pending = await walGetPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.applied).toBe(false);
    });

    it('marks entries as applied', async () => {
      await walWrite({ id: 'e1', table: 'case_entries', operation: 'create', rowId: 'r1', data: {} });
      await walMarkApplied('e1');
      const pending = await walGetPending();
      expect(pending).toHaveLength(0);
    });
  });

  describe('integrity verification', () => {
    it('passes for valid rows', async () => {
      const result = await verifyTableIntegrity('case_entries', [
        { tenant_id: 't1', created_at: 1000, updated_at: 2000, local_sync_status: 'synced', server_id: 's1' },
      ]);
      expect(result.passed).toBe(true);
      expect(result.totalRows).toBe(1);
    });

    it('fails for rows with bad timestamps', async () => {
      const result = await verifyTableIntegrity('case_entries', [
        { tenant_id: 't1', created_at: NaN, updated_at: -1, local_sync_status: 'synced', server_id: 's1' },
      ]);
      expect(result.passed).toBe(false);
      expect(result.corruptedTimestamps).toBe(2);
    });
  });

  describe('withTimeout', () => {
    it('returns result when fast enough', async () => {
      const result = await withTimeout(async () => 'ok', 1000, 'fallback');
      expect(result).toBe('ok');
    });

    it('returns fallback when too slow', async () => {
      const result = await withTimeout(async () => {
        await new Promise((r) => setTimeout(r, 2000));
        return 'ok';
      }, 100, 'fallback');
      expect(result).toBe('fallback');
    });
  });

  describe('withRetry', () => {
    it('succeeds on first try', async () => {
      const result = await withRetry(async () => 'ok', 3, 10);
      expect(result).toBe('ok');
    });

    it('retries and eventually succeeds', async () => {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'ok';
      }, 3, 10);
      expect(result).toBe('ok');
      expect(attempts).toBe(3);
    });
  });
});
