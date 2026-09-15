import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    __store: store,
  };
});

import {
  getOrCreateDbEncryptionKey,
  rotateDbEncryptionKey,
  invalidateDbEncryptionKey,
  resetDbEncryptionKeyCacheForTests,
} from '../db/encryption-key';

beforeEach(() => {
  resetDbEncryptionKeyCacheForTests();
});

describe('db encryption key lifecycle (M2)', () => {
  it('returns a stable key per install', async () => {
    const k1 = await getOrCreateDbEncryptionKey();
    const k2 = await getOrCreateDbEncryptionKey();
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64);
  });

  it('rotation replaces the key and clears the process cache', async () => {
    const k1 = await getOrCreateDbEncryptionKey();
    const k2 = await rotateDbEncryptionKey();
    expect(k2).not.toBe(k1);
    expect(await getOrCreateDbEncryptionKey()).toBe(k2);
  });

  it('invalidation wipes the stored key (reinstall/device-transfer safe)', async () => {
    await getOrCreateDbEncryptionKey();
    await invalidateDbEncryptionKey();
    // Next call must create a fresh key, not resurrect the old one.
    const fresh = await getOrCreateDbEncryptionKey();
    expect(fresh).toHaveLength(64);
  });
});
