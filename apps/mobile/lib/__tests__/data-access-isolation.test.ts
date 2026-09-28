import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rows, db } = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    write: vi.fn(async (work: () => Promise<unknown>) => work()),
    get: vi.fn(() => ({
      create: vi.fn(async (build: (row: Record<string, unknown>) => void) => {
        const row: Record<string, unknown> = {};
        await build(row);
        rows.push(row);
        return { id: 'local-row' };
      }),
    })),
  };
  return { rows, db };
});

vi.mock('@nozbe/watermelondb', () => ({
  Q: {
    and: (...conditions: unknown[]) => ({ kind: 'and', conditions }),
    where: (column: string, value: unknown) => ({ kind: 'where', column, value }),
    notEq: (column: string, value: unknown) => ({ kind: 'notEq', column, value }),
  },
}));

vi.mock('../db/database', () => ({ getDatabase: () => db }));
vi.mock('../db/encryption-key', () => ({ getOrCreateDbEncryptionKey: async () => '00'.repeat(32) }));
vi.mock('../crypto/aead', () => ({
  encryptText: async (_key: Uint8Array, value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decryptText: async (_key: Uint8Array, value: string) => Buffer.from(value, 'base64').toString('utf8'),
}));

import {
  createCaseEntry,
  createComment,
  createEvaluationForm,
  createShift,
  getActiveClinicalScope,
} from '../data-access';
import { clearAccountContext, setAccountContext } from '../account-context';

beforeEach(() => {
  rows.length = 0;
  clearAccountContext();
  setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1', role: 'resident' });
});

describe('local clinical data access isolation', () => {
  it('requires an active account scope', () => {
    expect(getActiveClinicalScope()).toEqual(expect.objectContaining({ tenantId: 't1', profileId: 'p1', userId: 'u1', scopeKey: expect.any(String) }));
    clearAccountContext();
    expect(() => getActiveClinicalScope()).toThrow(/account context|scope/i);
  });

  it('rejects an inactive profile or tenant scope', () => {
    setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1', role: 'resident', status: 'suspended' });
    expect(() => getActiveClinicalScope()).toThrow(/inactive|active/i);
  });

  it('rejects writes for a different tenant', async () => {
    await expect(
      createShift({ tenant_id: 't2', resident_id: 'p1', shift_date: '2026-01-01', hours_worked: 1, shift_type: 'regular' }),
    ).rejects.toThrow(/tenant|scope/i);
  });

  it('seals evaluation, comment, shift, and case free text before local persistence', async () => {
    await createCaseEntry({
      tenant_id: 't1',
      resident_id: 'p1',
      patientMrn: 'MRN-1',
      patientDob: '1980-01-01',
      fieldValues: { note: 'clinical note' },
    } as never);
    await createEvaluationForm({
      tenant_id: 't1',
      resident_id: 'p1',
      evaluator_id: 'p1',
      form_type: 'mini_cex',
      setting: 'ward',
      patientContext: 'acute abdomen',
      ratings: { clinical: 4 },
      feedback: 'needs detail',
      actionPlan: 'review tomorrow',
    } as never);
    await createComment({ tenant_id: 't1', author_id: 'p1', body: 'comment body' });
    await createShift({ tenant_id: 't1', resident_id: 'p1', shift_date: '2026-01-01', hours_worked: 1, shift_type: 'regular', notes: 'handover note' });

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('MRN-1');
    expect(serialized).not.toContain('clinical note');
    expect(serialized).not.toContain('acute abdomen');
    expect(serialized).not.toContain('needs detail');
    expect(serialized).not.toContain('review tomorrow');
    expect(serialized).not.toContain('comment body');
    expect(serialized).not.toContain('handover note');
    expect(serialized).toContain('__sealed');
    expect(rows.every((row) => typeof row.localScope === 'string' && row.localScope.length > 0)).toBe(true);
  });
});
