import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { caseDraftPath, saveCaseDraft } from '../submit-flow';

const callers = [
  'components/CaseForm.tsx',
  'components/QuickAddCase.tsx',
  'components/CaseImport.tsx',
];

describe('caseDraftPath', () => {
  it('resolves the guarded draft API route', () => {
    expect(caseDraftPath('acme')).toBe('/api/acme/cases');
  });
});

describe('saveCaseDraft', () => {
  it('posts only the de-identified command payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, case_id: 'case-1', status: 'draft' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    const result = await saveCaseDraft('acme', {
      request_id: 'req-1',
      tenant_id: 'tenant-1',
      resident_id: 'profile-1',
      template_id: 'template-1',
      case_date: '2026-09-23',
      field_values: { procedure_name: 'Appendectomy' },
      accreditation_mappings: [],
      is_deidentified: true,
      patient_age_years: 30,
      patient_mrn: null,
      patient_dob: null,
      status: 'draft',
    }, fetchMock);

    expect(fetchMock).toHaveBeenCalledWith('/api/acme/cases', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        request_id: 'req-1',
        template_id: 'template-1',
        case_date: '2026-09-23',
        field_values: { procedure_name: 'Appendectomy' },
        accreditation_mappings: [],
        is_deidentified: true,
        patient_age_years: 30,
      }),
    }));
    expect(result).toEqual({ id: 'case-1', error: null });
  });
});

describe('draft command callers', () => {
  it.each(callers)('%s has no direct case_entries insert', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/from\(['"]case_entries['"]\)\.insert/);
    expect(source).toContain('saveCaseDraft');
  });
});
