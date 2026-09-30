import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }));
vi.mock('@/lib/audit/record-phi-view', () => ({ recordPhiView: vi.fn() }));

import { createServerSupabase } from '@/lib/supabase/server';
import { recordPhiView } from '@/lib/audit/record-phi-view';
import { revealCasePhiField } from '../phi-reveal-actions';

const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function supabaseReturning(row: Record<string, unknown> | null) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ select })) } as never;
}

describe('revealCasePhiField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordPhiView).mockResolvedValue(true);
  });

  it('returns the value once the disclosure is recorded', async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(
      supabaseReturning({ id: ENTRY_ID, tenant_id: TENANT_ID, is_deidentified: false, patient_mrn: 'MRN-4242' }),
    );

    const result = await revealCasePhiField(ENTRY_ID, 'mrn');

    expect(result).toEqual({ value: 'MRN-4242' });
    expect(recordPhiView).toHaveBeenCalledWith(expect.anything(), {
      entryId: ENTRY_ID,
      tenantId: TENANT_ID,
      field: 'mrn',
    });
  });

  it('withholds the value when the audit write is refused', async () => {
    // Fail closed: an identifier that reaches the client without an audit row is
    // an unlogged disclosure, which is the thing this control exists to prevent.
    vi.mocked(createServerSupabase).mockResolvedValue(
      supabaseReturning({ id: ENTRY_ID, tenant_id: TENANT_ID, is_deidentified: false, patient_mrn: 'MRN-4242' }),
    );
    vi.mocked(recordPhiView).mockResolvedValue(false);

    const result = await revealCasePhiField(ENTRY_ID, 'mrn');

    expect(result.value).toBeNull();
    expect(result.reason).toBe('audit_failed');
  });

  it('refuses a de-identified case without recording a disclosure', async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(
      supabaseReturning({ id: ENTRY_ID, tenant_id: TENANT_ID, is_deidentified: true, patient_mrn: null }),
    );

    const result = await revealCasePhiField(ENTRY_ID, 'mrn');

    expect(result).toEqual({ value: null, reason: 'deidentified' });
    expect(recordPhiView).not.toHaveBeenCalled();
  });

  it('returns nothing for a row the caller cannot see', async () => {
    // RLS decides visibility, so an invisible row simply does not return. Nothing
    // here distinguishes "no such case" from "not yours", which is what keeps
    // this from being a tenant membership oracle.
    vi.mocked(createServerSupabase).mockResolvedValue(supabaseReturning(null));

    const result = await revealCasePhiField(ENTRY_ID, 'mrn');

    expect(result).toEqual({ value: null, reason: 'not_found' });
    expect(recordPhiView).not.toHaveBeenCalled();
  });

  it('returns nothing when no identifier is stored', async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(
      supabaseReturning({ id: ENTRY_ID, tenant_id: TENANT_ID, is_deidentified: false, patient_mrn: null }),
    );

    const result = await revealCasePhiField(ENTRY_ID, 'mrn');

    expect(result).toEqual({ value: null, reason: 'not_found' });
  });

  it('issues no request for a malformed id or an unknown field', async () => {
    await expect(revealCasePhiField('a,b', 'mrn')).resolves.toEqual({
      value: null,
      reason: 'not_found',
    });
    await expect(
      revealCasePhiField(ENTRY_ID, 'the whole chart' as 'mrn'),
    ).resolves.toEqual({ value: null, reason: 'not_found' });
    expect(createServerSupabase).not.toHaveBeenCalled();
  });
});
