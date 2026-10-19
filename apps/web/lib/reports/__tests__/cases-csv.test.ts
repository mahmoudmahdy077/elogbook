import { describe, it, expect } from 'vitest';
import { buildCasesCsv, exportableCaseRows } from '../cases-csv';

const ENTRY = '22222222-2222-4222-8222-222222222222';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY,
    case_date: '2026-02-01',
    status: 'approved',
    patient_mrn: 'MRN-4242',
    case_templates: { name: 'Appendectomy', specialty: 'surgery' },
    ...overrides,
  };
}

describe('exportableCaseRows', () => {
  it('keeps only approved cases', () => {
    const rows = exportableCaseRows([
      row({ id: '1', status: 'approved' }),
      row({ id: '2', status: 'pending' }),
      row({ id: '3', status: 'rejected' }),
      row({ id: '4', status: 'draft' }),
    ]);

    expect(rows).toHaveLength(1);
  });

  it('returns an empty list when nothing is approved', () => {
    expect(exportableCaseRows([row({ status: 'pending' })])).toEqual([]);
  });
});

describe('buildCasesCsv', () => {
  it('never emits a patient identifier column', () => {
    const csv = buildCasesCsv([row()]);

    expect(csv.split('\n')[0]).toBe('Case Date,Template,Specialty,Status');
    expect(csv).not.toContain('MRN');
    expect(csv).not.toContain('MRN-4242');
  });

  it('uses the shared CSV sanitizer for every cell', () => {
    const csv = buildCasesCsv([
      row({ case_templates: { name: '=cmd()', specialty: 'a,b' } as never }),
    ]);

    expect(csv).toContain("'=cmd()");
    expect(csv).toContain('"a,b"');
  });

  it('escapes template text that could inject a formula', () => {
    const csv = buildCasesCsv([row({ case_templates: { name: '+SUM(A1)', specialty: 'surgery' } as never })]);

    expect(csv).toContain("'+SUM(A1)");
  });

  it('excludes pending and rejected cases', () => {
    const csv = buildCasesCsv([
      row({ id: '1', case_date: '2026-01-01', status: 'approved' }),
      row({ id: '2', case_date: '2026-01-02', status: 'pending' }),
      row({ id: '3', case_date: '2026-01-03', status: 'rejected' }),
    ]);

    expect(csv).not.toContain('2026-01-02');
    expect(csv).not.toContain('2026-01-03');
    expect(csv).toContain('2026-01-01');
  });

  it('returns only the header when nothing is exportable', () => {
    expect(buildCasesCsv([row({ status: 'draft' })])).toBe('Case Date,Template,Specialty,Status');
  });
});
