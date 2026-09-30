import { describe, expect, it } from 'vitest';

// CSV case import is a de-identified data path: every row becomes a
// `field_values` object on a case entry. The import must therefore be a
// validated projection of the template's own fields -- never a raw dump of
// whatever columns the file happened to contain -- and it must fail closed on
// anything it cannot vouch for.

import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  RESERVED_IMPORT_COLUMNS,
  parseCaseImportCsv,
  type ImportTemplateField,
} from '../import-rows';

const FIELDS: ImportTemplateField[] = [
  { key: 'diagnosis', type: 'text' },
  { key: 'procedures', type: 'textarea' },
  { key: 'complexity', type: 'number' },
  { key: 'setting', type: 'select', options: ['clinic', 'ward'] },
  { key: 'supervised', type: 'checkbox' },
  { key: 'performed_on', type: 'date' },
];

function csv(header: string, ...rows: string[]): string {
  return [header, ...rows].join('\n');
}

describe('parseCaseImportCsv bounds', () => {
  it('rejects a file larger than the byte budget', () => {
    const result = parseCaseImportCsv({
      text: 'diagnosis\nx',
      byteLength: MAX_IMPORT_BYTES + 1,
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'file_too_large' });
  });

  it('rejects more rows than the row budget', () => {
    const header = 'diagnosis';
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => 'x');
    const result = parseCaseImportCsv({ text: csv(header, ...rows), fields: FIELDS });
    expect(result).toMatchObject({ ok: false, code: 'too_many_rows' });
  });

  it('rejects an empty file', () => {
    expect(parseCaseImportCsv({ text: '\n\n', fields: FIELDS })).toMatchObject({
      ok: false,
      code: 'empty_file',
    });
  });

  it('rejects a cell longer than the per-field budget', () => {
    const result = parseCaseImportCsv({
      text: csv('diagnosis', 'x'.repeat(5000)),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'cell_too_long' });
  });
});

describe('parseCaseImportCsv column allowlist', () => {
  it('accepts only declared template fields plus the case date', () => {
    const result = parseCaseImportCsv({
      text: csv('case_date,diagnosis,unknown_column', '2026-09-01,appendicitis,leak'),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'unknown_column' });
    if (!result.ok) expect(result.message).toContain('unknown_column');
  });

  it.each(RESERVED_IMPORT_COLUMNS)('refuses the identifier column %s outright', (column) => {
    const result = parseCaseImportCsv({
      text: csv(`${column},diagnosis`, 'identifier-value,appendicitis'),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'identifier_column' });
  });

  it('does not smuggle an identifier column through a near-miss name', () => {
    const result = parseCaseImportCsv({
      text: csv('patient_mrn_hash,diagnosis', 'x,appendicitis'),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'identifier_column' });
  });
});

describe('parseCaseImportCsv value projection', () => {
  it('projects declared fields into field_values and keeps the case date separate', () => {
    const result = parseCaseImportCsv({
      text: csv(
        'case_date,diagnosis,complexity,setting,supervised,performed_on',
        '2026-09-01,appendicitis,3,ward,true,2026-09-01',
      ),
      fields: FIELDS,
    });
    expect(result).toEqual({
      ok: true,
      headers: ['case_date', 'diagnosis', 'complexity', 'setting', 'supervised', 'performed_on'],
      rows: [
        {
          caseDate: '2026-09-01',
          fieldValues: {
            diagnosis: 'appendicitis',
            complexity: 3,
            setting: 'ward',
            supervised: true,
            performed_on: '2026-09-01',
          },
          templateSelector: null,
        },
      ],
    });
  });

  it('coerces numeric and checkbox values by declared type', () => {
    const result = parseCaseImportCsv({
      text: csv('complexity,supervised', 'not-a-number,maybe'),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_value' });
  });

  it('rejects a select value outside the declared options', () => {
    const result = parseCaseImportCsv({
      text: csv('setting', 'rooftop'),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_value' });
  });

  it('rejects a case date that is not ISO', () => {
    const result = parseCaseImportCsv({
      text: csv('case_date,diagnosis', '09/01/2026,appendicitis'),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_value' });
  });
});

describe('parseCaseImportCsv formula injection', () => {
  it.each([
    ['=cmd|calc', 'diagnosis'],
    ['+1+1', 'diagnosis'],
    ['-2+3', 'diagnosis'],
    ['@SUM(A1)', 'diagnosis'],
  ])('refuses the spreadsheet formula %s in a %s cell', (value, column) => {
    const result = parseCaseImportCsv({ text: csv(column, value), fields: FIELDS });
    expect(result).toMatchObject({ ok: false, code: 'formula_injection' });
  });

  it('refuses a formula hidden behind leading whitespace or a control tab', () => {
    for (const value of [' =cmd|calc', '\t=cmd|calc', '\n=cmd|calc']) {
      const result = parseCaseImportCsv({ text: csv('diagnosis', value), fields: FIELDS });
      expect(result).toMatchObject({ ok: false, code: 'formula_injection' });
    }
  });

  it('refuses a formula in a quoted cell', () => {
    const result = parseCaseImportCsv({ text: 'diagnosis\n"=cmd|calc"', fields: FIELDS });
    expect(result).toMatchObject({ ok: false, code: 'formula_injection' });
  });
});

describe('parseCaseImportCsv PHI refusal', () => {
  it('refuses an MRN-like digit run inside a de-identified field', () => {
    const result = parseCaseImportCsv({
      text: csv('diagnosis', 'patient 1234567 seen today'),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'phi_value' });
  });

  it('refuses an ISO date inside a free-text field', () => {
    const result = parseCaseImportCsv({
      text: csv('diagnosis', 'seen on 2026-09-01 in clinic'),
      fields: FIELDS,
    });
    expect(result).toMatchObject({ ok: false, code: 'phi_value' });
  });
});
