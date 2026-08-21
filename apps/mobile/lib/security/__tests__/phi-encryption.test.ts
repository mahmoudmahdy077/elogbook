import { describe, it, expect, vi } from 'vitest';

vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { store.set(k, v); },
    deleteItemAsync: async (k: string) => { store.delete(k); },
  };
});

vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  },
}));

import {
  encryptPHIField, decryptPHIField, encryptPHIRow, decryptPHIRow,
  isEncrypted, PHI_FIELDS,
} from '../phi-encryption';

describe('PHI field encryption', () => {
  it('encrypts and decrypts a text field', async () => {
    const encrypted = await encryptPHIField('MRN-12345');
    expect(encrypted).not.toBe('MRN-12345');
    expect(encrypted).not.toBeNull();
    const decrypted = await decryptPHIField(encrypted);
    expect(decrypted).toBe('MRN-12345');
  });

  it('encrypts and decrypts a JSON field', async () => {
    const data = { diagnosis: 'fracture', notes: 'left wrist' };
    const encrypted = await encryptPHIField(data);
    expect(encrypted).not.toContain('fracture');
    const decrypted = await decryptPHIField(encrypted);
    expect(JSON.parse(decrypted as string)).toEqual(data);
  });

  it('passes through null/undefined', async () => {
    expect(await encryptPHIField(null)).toBeNull();
    expect(await encryptPHIField(undefined)).toBeUndefined();
    expect(await decryptPHIField(null)).toBeNull();
    expect(await decryptPHIField(undefined)).toBeUndefined();
  });

  it('passes through empty string', async () => {
    expect(await encryptPHIField('')).toBe('');
    expect(await decryptPHIField('')).toBe('');
  });

  it('isEncrypted detects envelopes', () => {
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted('hello')).toBe(false);
    expect(isEncrypted('01abcd1234')).toBe(true);
  });

  it('encrypts/decrypts a full row', async () => {
    const row = {
      id: '1',
      patient_mrn: 'MRN-SECRET',
      patient_dob: '1990-01-01',
      status: 'draft',
      field_values: { diagnosis: 'test' },
    };
    const encrypted = await encryptPHIRow('case_entries', row);
    expect(encrypted.patient_mrn).not.toBe('MRN-SECRET');
    expect(encrypted.patient_dob).not.toBe('1990-01-01');
    expect(encrypted.status).toBe('draft'); // not PHI

    const decrypted = await decryptPHIRow('case_entries', encrypted);
    expect(decrypted.patient_mrn).toBe('MRN-SECRET');
    expect(decrypted.patient_dob).toBe('1990-01-01');
  });

  it('PHI_FIELDS defines correct columns', () => {
    expect(PHI_FIELDS.case_entries).toHaveLength(3);
    expect(PHI_FIELDS.case_entries.map((c) => c.name)).toContain('patient_mrn');
    expect(PHI_FIELDS.evaluation_forms).toHaveLength(1);
  });
});
