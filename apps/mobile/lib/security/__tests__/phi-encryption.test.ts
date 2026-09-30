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

  it('covers every quasi-identifier case_entries column, not just the obvious two', async () => {
    // patient_age_years / patient_hash / case_date are re-identifying in a
    // small cohort: an age plus a date plus a stable hash is often enough to
    // single a patient out. Leaving them in plaintext at rest is the same
    // disclosure as leaving an MRN there.
    expect(PHI_FIELDS.case_entries.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'patient_mrn',
        'patient_dob',
        'patient_age_years',
        'patient_hash',
        'case_date',
        'field_values',
      ]),
    );
  });

  it('encrypts every case_entries PHI column in a row', async () => {
    const row = {
      id: '1',
      patient_mrn: 'MRN-SECRET',
      patient_dob: '1990-01-01',
      patient_age_years: 34,
      patient_hash: 'a1b2c3d4',
      case_date: '2026-09-01',
      field_values: { diagnosis: 'x' },
      status: 'draft',
    };
    const encrypted = await encryptPHIRow('case_entries', row);
    for (const column of PHI_FIELDS.case_entries) {
      // Envelope, not the value: a short value like "34" can appear by chance
      // inside hex ciphertext, so the check is that the value is no longer the
      // stored representation rather than a substring test.
      const stored = (encrypted as Record<string, unknown>)[column.name];
      expect(isEncrypted(stored)).toBe(true);
    }
    expect(encrypted.status).toBe('draft');

    const decrypted = await decryptPHIRow('case_entries', encrypted);
    expect(decrypted.patient_mrn).toBe('MRN-SECRET');
    expect(decrypted.patient_dob).toBe('1990-01-01');
    expect(decrypted.patient_age_years).toBe(34);
    expect(decrypted.patient_hash).toBe('a1b2c3d4');
    expect(decrypted.case_date).toBe('2026-09-01');
  });

  it('fails closed for a case_date left in plaintext rather than passing it through', async () => {
    // No production plaintext fallback: a value that is not an envelope and is
    // not null/empty is refused, so a partially-encrypted row cannot render.
    await expect(decryptPHIField('2026-09-01')).resolves.toBeNull();
  });

  it('rejects plaintext values instead of treating them as decrypted data', async () => {
    await expect(decryptPHIField('MRN-PLAINTEXT')).resolves.toBeNull();
  });
  it('fails closed (null) on tamper instead of returning the envelope', async () => {
    const encrypted = (await encryptPHIField('MRN-12345')) as string;
    const tampered = `${encrypted.slice(0, -4)}ffff`;
    await expect(decryptPHIField(tampered)).resolves.toBeNull();
  });

  it('PHI_FIELDS covers clinical free text in every local clinical table', () => {
    expect(PHI_FIELDS.case_entries.map((c) => c.name)).toEqual(
      expect.arrayContaining(['patient_mrn', 'patient_dob', 'field_values']),
    );
    expect(PHI_FIELDS.evaluation_forms.map((c) => c.name)).toEqual(
      expect.arrayContaining(['setting', 'patient_context', 'ratings', 'feedback', 'action_plan']),
    );
    expect(PHI_FIELDS.comments.map((c) => c.name)).toEqual(expect.arrayContaining(['body']));
    expect(PHI_FIELDS.rotations.map((c) => c.name)).toEqual(expect.arrayContaining(['notes']));
    expect(PHI_FIELDS.milestones.map((c) => c.name)).toEqual(expect.arrayContaining(['comments']));
    expect(PHI_FIELDS.shifts.map((c) => c.name)).toEqual(expect.arrayContaining(['notes']));
  });

  it('encrypts and fails closed for evaluation free text', async () => {
    const row = {
      setting: 'inpatient ward',
      patient_context: 'patient with acute abdomen',
      ratings: { clinical: 4 },
      feedback: 'needs more detail',
      action_plan: 'review tomorrow',
      status: 'pending',
    };
    const encrypted = await encryptPHIRow('evaluation_forms', row);
    expect(JSON.stringify(encrypted)).not.toContain('inpatient ward');
    expect(JSON.stringify(encrypted)).not.toContain('acute abdomen');
    expect(JSON.stringify(encrypted)).not.toContain('needs more detail');
    expect(JSON.stringify(encrypted)).not.toContain('review tomorrow');
    expect(encrypted.status).toBe('pending');
  });
});
