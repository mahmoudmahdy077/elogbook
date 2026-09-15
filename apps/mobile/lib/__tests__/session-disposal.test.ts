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
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ insert: async () => ({ error: null }) }),
  },
}));
vi.mock('../auth-guard', () => ({
  getRoleFromAuth: async () => ({ role: null, fullName: null, tenantId: null, profileId: null }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAccountContext, clearAccountContext, scopedKey } from '../account-context';
import { saveDraft, loadDraft } from '../draft-store';
import { enqueueDurable, readDurableQueue } from '../durable-queue';
import { disposeAccountContext } from '../session-disposal';

beforeEach(async () => {
  await AsyncStorage.clear();
  clearAccountContext();
});

describe('session disposal (M1.3)', () => {
  it('wipes the old draft so a new account cannot read it', async () => {
    setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
    await saveDraft({ patientMrn: 'U1-SECRET' });
    const stopWorker = vi.fn();
    await disposeAccountContext({ stopWorkers: [stopWorker] });
    expect(stopWorker).toHaveBeenCalled();
    setAccountContext({ userId: 'u2', tenantId: 't1', profileId: 'p2' });
    await expect(loadDraft()).resolves.toBeNull();
  });

  it('quarantines (preserves under old scope) queued work instead of deleting it', async () => {
    setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
    await enqueueDurable('case_entries', 'insert', { a: 1 });
    const oldKey = scopedKey('durable_queue.v1');
    await disposeAccountContext({});
    // Old scope data is untouched under its own key (quarantine, not loss).
    expect(await AsyncStorage.getItem(oldKey)).toBeTruthy();
    // New scope starts empty.
    setAccountContext({ userId: 'u2', tenantId: 't1', profileId: 'p2' });
    expect(await readDurableQueue()).toHaveLength(0);
  });

  it('clears telemetry identity and push context via callbacks', async () => {
    const clearTelemetry = vi.fn();
    const rotatePush = vi.fn();
    await disposeAccountContext({ clearTelemetryIdentity: clearTelemetry, rotatePushContext: rotatePush });
    expect(clearTelemetry).toHaveBeenCalled();
    expect(rotatePush).toHaveBeenCalled();
  });

  it('wipes the persisted analytics queue (no cross-account export)', async () => {
    const { trackEvent, flushEventQueue, ackEventFlush, requeueEvents } = await import('../production/telemetry');
    await trackEvent('case_created', { template_id: 'tpl-1', patientMrn: 'SECRET' });
    const batch = await flushEventQueue();
    expect(batch).toHaveLength(1);
    // Failed upload: requeue restores the batch for a later retry.
    await ackEventFlush(Math.max(...batch.map((e) => e.timestamp)));
    expect(await flushEventQueue()).toHaveLength(0);
    await requeueEvents(batch);
    expect(await flushEventQueue()).toHaveLength(1);
    await disposeAccountContext({});
    expect(await flushEventQueue()).toHaveLength(0);
  });
});
