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

describe('offline queue', () => {
  it('encrypts payloads at rest', async () => {
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
});
