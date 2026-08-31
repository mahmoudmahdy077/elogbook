import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
    },
  };
});
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => new Uint8Array(n).fill(7),
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
import { enqueueCase, readQueue, getPendingCount, flushQueue, OFFLINE_QUEUE_KEY } from '../offline-queue';

beforeEach(async () => {
  await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
});

describe('offline queue v2 (AEAD)', () => {
  it('encrypts payloads at rest (no plaintext in storage)', async () => {
    await enqueueCase({ patient_mrn: 'SECRET-MRN', tenant_id: 't1' });
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('SECRET-MRN');
    expect(await getPendingCount()).toBe(1);
  });

  it('flushes items and clears the queue', async () => {
    await enqueueCase({ tenant_id: 't1', status: 'draft' });
    const result = await flushQueue();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(await readQueue()).toHaveLength(0);
  });

  it('rejects tampered ciphertext (MAC fails, item dropped)', async () => {
    await enqueueCase({ tenant_id: 't1', secret: 'PHI' });
    // Tamper with the ciphertext in storage
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    const items = JSON.parse(raw!);
    // Corrupt the ciphertext string
    items[0].ciphertext = items[0].ciphertext.slice(0, -4) + 'ffff';
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));

    const result = await flushQueue();
    expect(result.synced).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.lastError).toContain('corrupted');
  });

  it('multiple enqueues accumulate correctly', async () => {
    await enqueueCase({ a: 1 });
    await enqueueCase({ b: 2 });
    await enqueueCase({ c: 3 });
    expect(await getPendingCount()).toBe(3);
  });

  it('generates RFC4122 v4 UUIDs using CSPRNG', async () => {
    await enqueueCase({ a: 1 });
    await enqueueCase({ b: 2 });
    const items = await readQueue();
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(items[0].id).toMatch(uuidV4Regex);
    expect(items[1].id).toMatch(uuidV4Regex);
    expect(items[0].id).not.toBe(items[1].id);
  });
});
