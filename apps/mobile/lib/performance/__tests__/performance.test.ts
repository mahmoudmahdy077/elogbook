import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: async () => ({ isConnected: true, type: 'wifi', details: { isConnectionExpensive: false } }) },
}));

import {
  cachedQuery, invalidateCache, computeDelta,
  getConnectionInfo, getSyncParams, compactStorage,
} from '../index';

describe('performance', () => {
  describe('query cache', () => {
    beforeEach(() => { invalidateCache(); });

    it('caches and returns cached data', async () => {
      let callCount = 0;
      const fetcher = async () => { callCount++; return 'data'; };
      const result = await cachedQuery('test', fetcher, 1000);
      expect(result).toBe('data');
      expect(callCount).toBe(1);

      // Second call should use cache
      const result2 = await cachedQuery('test', fetcher, 1000);
      expect(result2).toBe('data');
      expect(callCount).toBe(1); // still 1
    });

    it('refetches after TTL expires', async () => {
      let callCount = 0;
      const fetcher = async () => { callCount++; return 'data'; };
      await cachedQuery('test', fetcher, 1); // 1ms TTL
      await new Promise((r) => setTimeout(r, 10));
      await cachedQuery('test', fetcher, 1);
      expect(callCount).toBe(2);
    });

    it('invalidation works', async () => {
      let callCount = 0;
      const fetcher = async () => { callCount++; return 'data'; };
      await cachedQuery('test', fetcher);
      invalidateCache('test');
      await cachedQuery('test', fetcher);
      expect(callCount).toBe(2);
    });
  });

  describe('computeDelta', () => {
    it('finds changed fields', () => {
      const old = { a: 1, b: 'hello', c: true };
      const newer = { a: 2, b: 'hello', c: true };
      const delta = computeDelta(old, newer);
      expect(delta).toEqual({ a: 2 });
    });

    it('skips metadata fields', () => {
      const old = { id: '1', created_at: 100, status: 'draft' };
      const newer = { id: '1', created_at: 200, status: 'approved' };
      const delta = computeDelta(old, newer);
      expect(delta).toEqual({ status: 'approved' });
    });

    it('returns empty when no changes', () => {
      const data = { a: 1, b: 'hello' };
      expect(computeDelta(data, { ...data })).toEqual({});
    });
  });

  describe('connection info', () => {
    it('returns quality', async () => {
      const info = await getConnectionInfo();
      expect(info.quality).toBeDefined();
      expect(typeof info.isMetered).toBe('boolean');
    });
  });

  describe('sync params', () => {
    it('returns different params per quality', () => {
      const excellent = getSyncParams('excellent');
      const slow = getSyncParams('slow');
      expect(excellent.pullPageSize).toBeGreaterThan(slow.pullPageSize);
      expect(excellent.syncIntervalMs).toBeLessThan(slow.syncIntervalMs);
    });
  });

  describe('compactStorage', () => {
    it('returns 0 when under limit', async () => {
      const removed = await compactStorage(1000);
      expect(removed).toBe(0);
    });
  });
});
