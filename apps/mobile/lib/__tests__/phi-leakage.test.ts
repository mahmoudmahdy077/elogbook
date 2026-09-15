import { describe, it, expect, vi, beforeEach } from 'vitest';

// R3: synthetic identifiable fixtures flow through EVERY local producer,
// then the test dumps the account scope's raw storage and asserts no
// plaintext MRN/DOB/identifier survives anywhere. Real network and native
// modules are mocked; the storage bytes are real.

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      clear: async () => { store.clear(); },
      __dump: () => [...store.entries()],
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
import { setAccountContext, clearAccountContext } from '../account-context';
import { saveDraft } from '../draft-store';
import { enqueueDurable } from '../durable-queue';
import { trackEvent } from '../production/telemetry';
import { logAuditEvent } from '../security/audit-trail';

const MRN = 'SYNTH-MRN-999-XYZ';
const DOB = '1977-05-05';

beforeEach(async () => {
  await AsyncStorage.clear();
  clearAccountContext();
  setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
});

describe('PHI leakage sweep (R3 synthetic identifiable fixtures)', () => {
  it('no plaintext identifier survives in any scoped store', async () => {
    await saveDraft({ patientMrn: MRN, patientDob: DOB, fieldValues: { dx: 'x' } });
    await enqueueDurable('case_entries', 'insert', { patient_mrn: MRN, patient_dob: DOB });
    await trackEvent('case_created', { template_id: 'tpl-1', patientMrn: MRN, patientDob: DOB });
    await logAuditEvent({ userId: 'u1', action: 'create', table: 'case_entries', rowId: 'r1', data: { patient_mrn: MRN } });

    const dump = (AsyncStorage as unknown as { __dump: () => Array<[string, string]> }).__dump();
    expect(dump.length).toBeGreaterThan(0);
    const blob = dump.map(([k, v]) => `${k}=${v}`).join('\n');
    expect(blob).not.toContain(MRN);
    expect(blob).not.toContain(DOB);
    // Identifiers may exist only as one-way hashes (audit data_hash).
    expect(blob).not.toMatch(/1977/);
  });
});
