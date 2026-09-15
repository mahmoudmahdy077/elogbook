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
import { saveDraft, loadDraft, clearDraft, DRAFT_SCHEMA_VERSION } from '../draft-store';

beforeEach(async () => {
  await AsyncStorage.clear();
  clearAccountContext();
  setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
});

describe('draft-store M2 (encrypted, versioned, scoped)', () => {
  it('stores no plaintext PHI at rest', async () => {
    await saveDraft({ patientMrn: 'SECRET-MRN-123', patientDob: '2000-01-01', fieldValues: { dx: 'x' } });
    // Envelope must exist and must not contain plaintext.
    const { scopedKey } = await import('../account-context');
    const raw = await AsyncStorage.getItem(scopedKey('case_form_draft.v1'));
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('SECRET-MRN-123');
    expect(raw).not.toContain('2000-01-01');
  });

  it('round-trips the draft for the same account', async () => {
    await saveDraft({ patientMrn: 'MRN', selectedTemplateId: 'tpl1', step: 2 });
    const loaded = await loadDraft();
    expect(loaded?.patientMrn).toBe('MRN');
    expect(loaded?.selectedTemplateId).toBe('tpl1');
    expect(loaded?.schemaVersion).toBe(DRAFT_SCHEMA_VERSION);
  });

  it('never falls back to plaintext on decrypt failure (returns null)', async () => {
    await saveDraft({ patientMrn: 'MRN' });
    const { scopedKey } = await import('../account-context');
    const key = scopedKey('case_form_draft.v1');
    const raw = await AsyncStorage.getItem(key);
    await AsyncStorage.setItem(key, `${raw!.slice(0, -4)}ffff`);
    await expect(loadDraft()).resolves.toBeNull();
  });

  it('refuses to write without an account scope (boot barrier)', async () => {
    clearAccountContext();
    await expect(saveDraft({ patientMrn: 'X' })).rejects.toThrow(/no account context/);
    await expect(loadDraft()).resolves.toBeNull();
  });

  it('is isolated per account: switching account hides the old draft', async () => {
    await saveDraft({ patientMrn: 'U1-DRAFT' });
    setAccountContext({ userId: 'u2', tenantId: 't1', profileId: 'p2' });
    await expect(loadDraft()).resolves.toBeNull();
  });

  it('clearDraft removes only the current scope', async () => {
    await saveDraft({ patientMrn: 'U1' });
    const { scopedKey } = await import('../account-context');
    const k1 = scopedKey('case_form_draft.v1');
    setAccountContext({ userId: 'u2', tenantId: 't1', profileId: 'p2' });
    await saveDraft({ patientMrn: 'U2' });
    await clearDraft();
    expect(await loadDraft()).toBeNull();
    setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
    const stillThere = await AsyncStorage.getItem(k1);
    expect(stillThere).toBeTruthy();
  });
});
