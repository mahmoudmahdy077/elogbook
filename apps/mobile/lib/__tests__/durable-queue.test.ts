import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      clear: async () => { store.clear(); },
    },
  };
});
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => {
    const out = new Uint8Array(n);
    (globalThis.crypto as Crypto).getRandomValues(out);
    return out;
  },
}));
vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { store.set(k, v); },
    deleteItemAsync: async (k: string) => { store.delete(k); },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAccountContext, clearAccountContext } from '../account-context';
import {
  enqueueDurable,
  readDurableQueue,
  flushDurableQueue,
  getDurableCounts,
  classifyQueueError,
} from '../durable-queue';

function rpcWith(
  impl: (args: { p_op_id: string; p_action: string; p_row_id: string | null; p_payload: Record<string, unknown> }) => Promise<{ data: unknown; error: { message: string } | null }>,
) {
  return { rpc: (_fn: string, args: never) => impl(args as never) };
}
const okResult = (extra: Record<string, unknown> = {}) => ({ data: { success: true, id: 'srv-1', ...extra }, error: null });

beforeEach(async () => {
  await AsyncStorage.clear();
  clearAccountContext();
  setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
});

describe('durable queue M3 (local-first outbox)', () => {
  it('assigns a stable op ID used as idempotency key (no plaintext at rest)', async () => {
    const opId = await enqueueDurable('case_entries', 'insert', { patient_mrn: 'SECRET' });
    expect(opId).toMatch(/^[0-9a-f-]{36}$/i);
    const items = await readDurableQueue();
    expect(items).toHaveLength(1);
    expect(items[0].opId).toBe(opId);
    expect(items[0].accountId).toBe('u1');
    expect(items[0].tenantId).toBe('t1');
    const { scopedKey } = await import('../account-context');
    const raw = await AsyncStorage.getItem(scopedKey('durable_queue.v1'));
    expect(raw).not.toContain('SECRET');
  });

  it('serializes concurrent enqueues (no RMW loss)', async () => {
    await Promise.all([enqueueDurable('case_entries', 'insert', { a: 1 }), enqueueDurable('case_entries', 'insert', { b: 2 }), enqueueDurable('case_entries', 'insert', { c: 3 })]);
    expect((await readDurableQueue()).length).toBe(3);
  });

  it('retries transient errors, quarantines policy errors (never silent)', async () => {
    await enqueueDurable('case_entries', 'insert', { a: 1 });
    await enqueueDurable('case_entries', 'insert', { b: 2 });
    let calls = 0;
    const sb = rpcWith(async () => {
      calls += 1;
      if (calls === 1) throw new Error('fetch failed: network timeout');
      return { data: { success: false, error: 'policy: identifiable records revoked for tenant' }, error: null };
    });
    const res = await flushDurableQueue(sb as never);
    expect(res.synced).toBe(0);
    expect(res.transient).toBe(1);
    expect(res.quarantined).toBe(1);
    expect(res.lastError).toBeTruthy();
    const counts = await getDurableCounts();
    expect(counts.queued).toBe(1);
    expect(counts.quarantined).toBe(1);
  });

  it('sends the stable op ID to the operation RPC (server dedupes replays)', async () => {
    const opId = await enqueueDurable('case_entries', 'insert', { a: 1 });
    const seen: Array<{ p_op_id: string; p_action: string }> = [];
    const sb = rpcWith(async (args) => {
      seen.push(args);
      return okResult();
    });
    await flushDurableQueue(sb as never);
    expect(seen).toHaveLength(1);
    expect(seen[0].p_op_id).toBe(opId);
    expect(seen[0].p_action).toBe('insert');
  });

  it('does not flush another account’s queue after switch (scoped isolation)', async () => {
    await enqueueDurable('case_entries', 'insert', { a: 1 });
    setAccountContext({ userId: 'u2', tenantId: 't1', profileId: 'p2' });
    const sb = rpcWith(async () => okResult());
    const res = await flushDurableQueue(sb as never);
    // New scope has no items; old scope's item is untouched under its own key.
    expect(res.synced).toBe(0);
    expect(await readDurableQueue()).toHaveLength(0);
    setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
    expect(await readDurableQueue()).toHaveLength(1);
  });

  it('classifies errors without dropping unknown failures', () => {
    expect(classifyQueueError('Network request failed')).toBe('transient');
    expect(classifyQueueError('JWT expired')).toBe('auth');
    expect(classifyQueueError('RLS policy violation')).toBe('policy');
    expect(classifyQueueError('duplicate key value')).toBe('conflict');
    expect(classifyQueueError('MAC verification failed')).toBe('tamper');
    expect(classifyQueueError('weird unknown boom')).toBe('unknown');
  });

  it('recovers items stuck in sending (process death between push and ack)', async () => {
    await enqueueDurable('case_entries', 'insert', { a: 1 });
    const { scopedKey } = await import('../account-context');
    const key = scopedKey('durable_queue.v1');
    const raw = await AsyncStorage.getItem(key);
    const items = JSON.parse(raw!);
    items[0].state = 'sending';
    await AsyncStorage.setItem(key, JSON.stringify(items));
    // Next read (new process) must see the item as queued again — no loss.
    expect(await readDurableQueue()).toHaveLength(1);
    expect((await getDurableCounts()).queued).toBe(1);
  });

  it('keeps pending items on partial batch failure (no loss, no silent drop)', async () => {
    await enqueueDurable('case_entries', 'insert', { a: 1 });
    await enqueueDurable('case_entries', 'insert', { b: 2 });
    let n = 0;
    const sb = rpcWith(async () => {
      n += 1;
      // First op succeeds, second hits a transient error mid-batch.
      if (n === 2) throw new Error('connect timeout');
      return okResult();
    });
    const res = await flushDurableQueue(sb as never);
    expect(res.synced).toBe(1);
    expect(res.transient).toBe(1);
    expect((await getDurableCounts()).queued).toBe(1);
  });

  it('tombstones deletes through the operation RPC (never an upsert)', async () => {
    await enqueueDurable('case_entries', 'delete', { id: 'row-9' });
    const seen: Array<{ p_action: string; p_row_id: string | null }> = [];
    const sb = rpcWith(async (args) => {
      seen.push(args);
      return okResult({ already_deleted: false });
    });
    const res = await flushDurableQueue(sb as never);
    expect(res.synced).toBe(1);
    expect(seen[0]).toMatchObject({ p_action: 'delete', p_row_id: 'row-9' });
  });

  it('quarantines terminal RPC denials with the server reason', async () => {
    await enqueueDurable('case_entries', 'update', { id: 'row-9', status: 'pending' });
    const sb = rpcWith(async () => ({ data: { success: false, error: 'policy: approved_locked' }, error: null }));
    const res = await flushDurableQueue(sb as never);
    expect(res.synced).toBe(0);
    expect(res.quarantined).toBe(1);
    expect(res.lastError).toContain('approved_locked');
  });

  it('bounds the queue (count) instead of growing without limit', async () => {
    const { MAX_QUEUE_ITEMS } = await import('../durable-queue');
    for (let i = 0; i < MAX_QUEUE_ITEMS; i++) {
      await enqueueDurable('case_entries', 'insert', { n: i });
    }
    await expect(enqueueDurable('case_entries', 'insert', { overflow: true })).rejects.toThrow(/queue full/);
  });

  it('backs corrupt storage up visibly instead of returning silent empty', async () => {
    await enqueueDurable('case_entries', 'insert', { a: 1 });
    const { scopedKey } = await import('../account-context');
    const key = scopedKey('durable_queue.v1');
    await AsyncStorage.setItem(key, '{not-json!!!');
    expect(await readDurableQueue()).toHaveLength(0);
    const { lastCorruptBackupKey } = await import('../durable-queue');
    expect(lastCorruptBackupKey()).toContain('.corrupt.');
  });

  it('describes queue states without ever claiming submitted', async () => {
    const { queueStatusCopy } = await import('../durable-queue');
    expect(queueStatusCopy({ queued: 0, quarantined: 0 })).toContain('sent');
    expect(queueStatusCopy({ queued: 2, quarantined: 0 })).toContain('sync when online');
    expect(queueStatusCopy({ queued: 0, quarantined: 1 })).toContain('attention');
    expect(queueStatusCopy({ queued: 1, quarantined: 1 }).toLowerCase()).not.toContain('submitted');
    expect(queueStatusCopy({ queued: 2, quarantined: 0 }, 'ar')).not.toBe(queueStatusCopy({ queued: 2, quarantined: 0 }, 'en'));
  });
});
