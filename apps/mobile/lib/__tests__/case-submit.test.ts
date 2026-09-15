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
vi.mock('../supabase', () => ({ supabase: {} }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAccountContext, clearAccountContext } from '../account-context';
import { readDurableQueue } from '../durable-queue';
import { submitCase, type SubmitDeps } from '../case-submit';
import type { CapabilitySnapshot } from '../capability';

function cap(over: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    userId: 'u1', tenantId: 't1', profileId: 'p1', role: 'resident', status: 'active',
    policyVersion: 3, dataMode: 'deidentified', mfaVerifiedAt: Date.now(),
    expiresAt: Date.now() + 3600_000, fetchedAt: Date.now(), ...over,
  };
}

function deps(over: Partial<SubmitDeps> = {}): SubmitDeps {
  return {
    capability: cap(),
    insertRow: async () => ({ serverId: 'srv-1' }),
    updateRow: async () => ({}),
    ...over,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  clearAccountContext();
  setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
});

describe('case-submit adapter (M3 — real submit path)', () => {
  it('reports submitted on server success (never queued)', async () => {
    const out = await submitCase(deps(), { action: 'insert', payload: { a: 1 } });
    expect(out).toEqual({ kind: 'submitted', serverId: 'srv-1' });
    expect(await readDurableQueue()).toHaveLength(0);
  });

  it('queues locally with a stable op ID on transient-network failure', async () => {
    const out = await submitCase(deps({ insertRow: async () => { throw new Error('fetch failed: network timeout'); } }), {
      action: 'insert', payload: { a: 1 },
    });
    expect(out.kind).toBe('queued-locally');
    const items = await readDurableQueue();
    expect(items).toHaveLength(1);
    if (out.kind === 'queued-locally') expect(items[0].opId).toBe(out.opId);
  });

  it('rejects (never claims saved) on policy denial', async () => {
    const out = await submitCase(
      deps({ insertRow: async () => { throw new Error('RLS policy violation'); } }),
      { action: 'insert', payload: { a: 1 } },
    );
    expect(out.kind).toBe('rejected');
    expect(await readDurableQueue()).toHaveLength(0);
  });

  it('denies without a server call when the capability is suspended', async () => {
    const insertRow = vi.fn();
    const out = await submitCase(deps({ capability: cap({ status: 'suspended' }), insertRow }), {
      action: 'insert', payload: { a: 1 },
    });
    expect(out.kind).toBe('rejected');
    expect(insertRow).not.toHaveBeenCalled();
  });

  it('fails closed with no capability (nothing persisted, recovery message)', async () => {
    const insertRow = vi.fn();
    const out = await submitCase(deps({ capability: null, insertRow }), {
      action: 'insert', payload: { a: 1, is_deidentified: true },
    });
    expect(out.kind).toBe('rejected');
    expect(insertRow).not.toHaveBeenCalled();
    expect(await readDurableQueue()).toHaveLength(0);
    if (out.kind === 'rejected') expect(out.reason).toMatch(/session|sign|verif/i);
  });

  it('rejects a mode mismatch before any persistence (identifiable under deidentified policy)', async () => {
    const insertRow = vi.fn();
    const out = await submitCase(deps({ insertRow }), {
      action: 'insert', payload: { a: 1, is_deidentified: false },
    });
    expect(out.kind).toBe('rejected');
    expect(insertRow).not.toHaveBeenCalled();
    expect(await readDurableQueue()).toHaveLength(0);
  });

  it('queues on a stale capability only when the mode matches (offline policy)', async () => {
    const insertRow = vi.fn();
    const stale = cap({ fetchedAt: Date.now() - 30 * 60_000 });
    const out = await submitCase(deps({ capability: stale, insertRow }), {
      action: 'insert', payload: { a: 1, is_deidentified: true },
    });
    expect(out.kind).toBe('queued-locally');
    expect(insertRow).not.toHaveBeenCalled();
  });

  it('rejects on a stale capability when the mode mismatches', async () => {
    const insertRow = vi.fn();
    const stale = cap({ fetchedAt: Date.now() - 30 * 60_000 });
    const out = await submitCase(deps({ capability: stale, insertRow }), {
      action: 'insert', payload: { a: 1, is_deidentified: false },
    });
    expect(out.kind).toBe('rejected');
    expect(await readDurableQueue()).toHaveLength(0);
  });

  it('shares one op ID between the online attempt and the queued retry', async () => {
    let attempted: Record<string, unknown> | null = null;
    const seen: Array<{ p_op_id: string }> = [];
    const sb = {
      rpc: async (_fn: string, args: { p_op_id: string }) => {
        seen.push(args);
        return { data: { success: true, id: 'srv-9' }, error: null };
      },
    };
    const out = await submitCase(
      deps({
        insertRow: async (payload) => {
          attempted = payload;
          throw new Error('Network request failed');
        },
      }),
      { action: 'insert', payload: { a: 1 } },
    );
    expect(out.kind).toBe('queued-locally');
    const opId = out.kind === 'queued-locally' ? out.opId : '';
    expect((attempted as Record<string, unknown> | null)?.client_operation_id).toBe(opId);
    expect(attempted).toBeTruthy();
    const { flushDurableQueue } = await import('../durable-queue');
    await flushDurableQueue(sb as never);
    expect(seen[0].p_op_id).toBe(opId);
  });

  it('rejects (never throws) when the local queue is full', async () => {
    const { enqueueDurable, MAX_QUEUE_ITEMS } = await import('../durable-queue');
    for (let i = 0; i < MAX_QUEUE_ITEMS; i++) {
      await enqueueDurable('case_entries', 'insert', { n: i });
    }
    const out = await submitCase(
      deps({ insertRow: async () => { throw new Error('Network request failed'); } }),
      { action: 'insert', payload: { a: 1, is_deidentified: true } },
    );
    expect(out.kind).toBe('rejected');
    if (out.kind === 'rejected') expect(out.reason).toMatch(/queue full/i);
  });

  it('preserves the row id for queued updates (server-routed tombstone-safe)', async () => {
    const seen: Array<{ p_op_id: string; p_action: string; p_row_id: string | null; p_payload: Record<string, unknown> }> = [];
    const sb = {
      rpc: async (_fn: string, args: never) => {
        seen.push(args as never);
        return { data: { success: true, id: 'row-9' }, error: null };
      },
    };
    const out = await submitCase(
      deps({ updateRow: async () => { throw new Error('Network request failed'); } }),
      { action: 'update', targetId: 'row-9', payload: { status: 'pending' } },
    );
    expect(out.kind).toBe('queued-locally');
    const { flushDurableQueue } = await import('../durable-queue');
    await flushDurableQueue(sb as never);
    const sent = seen[0];
    expect(sent.p_action).toBe('update');
    expect(sent.p_row_id).toBe('row-9');
    expect(sent.p_payload).toMatchObject({ status: 'pending' });
    expect(sent.p_payload.id).toBeUndefined();
    expect(typeof sent.p_op_id).toBe('string');
  });
});
