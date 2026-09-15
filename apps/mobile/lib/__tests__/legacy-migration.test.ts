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
  supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAccountContext, clearAccountContext } from '../account-context';
import { enqueueCase, OFFLINE_QUEUE_KEY } from '../offline-queue';
import { readDurableQueue } from '../durable-queue';
import { migrateLegacyQueueOnce, migrateLegacyDraftOnce, migrateAuditBufferOnce } from '../legacy-migration';

beforeEach(async () => {
  await AsyncStorage.clear();
  clearAccountContext();
  setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
});

describe('legacy migration (M2/M3 upgrade safety)', () => {
  it('moves legacy v2 queue items into the durable outbox exactly once', async () => {
    await enqueueCase({ tenant_id: 't1', status: 'draft' });
    await enqueueCase({ tenant_id: 't1', status: 'draft' });
    const { readQueue } = await import('../offline-queue');
    const legacyIds = (await readQueue()).map((i) => i.id);
    expect(await migrateLegacyQueueOnce()).toBe(2);
    const durable = await readDurableQueue();
    expect(durable).toHaveLength(2);
    // N3: legacy UUIDs survive as op IDs (replay protection across migration).
    expect(durable.map((d) => d.opId).sort()).toEqual([...legacyIds].sort());
    expect(await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)).toBeNull();
    expect(await migrateLegacyQueueOnce()).toBe(0);
  });

  it('leaves the legacy key intact when there is no account context', async () => {
    await enqueueCase({ tenant_id: 't1' });
    clearAccountContext();
    expect(await migrateLegacyQueueOnce()).toBe(0);
    expect(await AsyncStorage.getItem(OFFLINE_QUEUE_KEY)).toBeTruthy();
  });

  it('deletes the legacy plaintext draft remnant', async () => {
    await AsyncStorage.setItem('case_form_draft', JSON.stringify({ patientMrn: 'OLD' }));
    await migrateLegacyDraftOnce();
    expect(await AsyncStorage.getItem('case_form_draft')).toBeNull();
  });

  it('moves only own audit entries to scope; quarantines the rest (no reattribution)', async () => {
    await AsyncStorage.setItem(
      'audit_trail_buffer_v1',
      JSON.stringify([
        { user_id: 'u1', action: 'read' },
        { user_id: 'intruder', action: 'read' },
      ]),
    );
    const res = await migrateAuditBufferOnce();
    expect(res).toEqual({ moved: 1, quarantined: 1 });
    const { scopedKey } = await import('../account-context');
    expect(JSON.parse((await AsyncStorage.getItem(scopedKey('audit_trail_buffer_v1')))!)).toHaveLength(1);
    expect(JSON.parse((await AsyncStorage.getItem('audit_trail_buffer_v1.quarantine'))!)).toHaveLength(1);
    expect(await AsyncStorage.getItem('audit_trail_buffer_v1')).toBeNull();
  });

  it('leaves the audit buffer intact without an account context', async () => {
    await AsyncStorage.setItem('audit_trail_buffer_v1', JSON.stringify([{ user_id: 'u1' }]));
    clearAccountContext();
    expect(await migrateAuditBufferOnce()).toEqual({ moved: 0, quarantined: 0 });
    expect(await AsyncStorage.getItem('audit_trail_buffer_v1')).toBeTruthy();
  });
});
