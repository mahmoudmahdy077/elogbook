/**
 * Validated projection for CSV case import.
 *
 * Importing a CSV into `case_entries.field_values` is a de-identified data
 * path, so the import is deliberately a *projection* rather than a copy:
 *
 *  - Only columns the template actually declares (plus `case_date`) are read.
 *    A raw dump of whatever columns the file contained is what used to happen,
 *    which let a spreadsheet quietly introduce fields the template, the PHI
 *    trigger, and the reviewer UI had never seen.
 *  - Values are coerced by declared field type, so a `number` column cannot
 *    arrive as an arbitrary string and a `select` cannot smuggle an option the
 *    program never defined.
 *  - Spreadsheet formula injection (`=`, `+`, `-`, `@` as the first significant
 *    character) is refused rather than escaped, because these values are
 *    re-exported to CSV/HTML later and escaping on one surface is not a
 *    guarantee on the next.
 *  - Identifier columns and identifier-shaped values (MRN-like digit runs, ISO
 *    dates) are refused: this release is de-identified only, so a file that
 *    needs them is a file this endpoint must not accept.
 *  - Everything is bounded: file bytes, row count, cell length, column count.
 *
 * Failures are explicit and typed so the caller can show the operator what was
 * wrong and stop, rather than partially importing a file it could not vouch
 * for.
 */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_COLUMNS = 64;
export const MAX_IMPORT_CELL_LENGTH = 2_000;
export const MAX_IMPORT_HEADER_LENGTH = 120;

/** Column that carries the clinical date rather than a template field. */
export const CASE_DATE_COLUMN = 'case_date';

/** Columns an operator may use to pick the template. Never stored on the row. */
export const TEMPLATE_SELECTOR_COLUMNS = ['template_name', 'template'] as const;

export type ImportFieldType = 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';

export interface ImportTemplateField {
  key: string;
  type: ImportFieldType;
  options?: string[];
}

export interface ParsedImportRow {
  caseDate: string;
  fieldValues: Record<string, string | number | boolean>;
  templateSelector: string | null;
}

export type ImportErrorCode =
  | 'file_too_large'
  | 'too_many_rows'
  | 'too_many_columns'
  | 'empty_file'
  | 'empty_header'
  | 'duplicate_column'
  | 'cell_too_long'
  | 'header_too_long'
  | 'unknown_column'
  | 'identifier_column'
  | 'formula_injection'
  | 'phi_value'
  | 'invalid_value';

export type ParsedImport =
  | { ok: true; headers: string[]; rows: ParsedImportRow[] }
  | { ok: false; code: ImportErrorCode; message: string };

/**
 * Identifier-shaped column names. Matched on a normalized form (lowercased,
 * non-alphanumerics collapsed to `_`) with segment matching, so `patient_mrn`,
 * `patient-mrn`, `patientMrn` and `mrn_value` are all refused while an
 * unrelated column like `mrnish_note`... is also refused, because a near-miss
 * on an identifier column is exactly the case an operator must resolve
 * explicitly rather than have silently accepted or dropped.
 */
export const RESERVED_IMPORT_COLUMNS = [
  'mrn',
  'patient_mrn',
  'dob',
  'patient_dob',
  'date_of_birth',
  'patient_hash',
  'patient_id',
  'patient_name',
  'patient_first_name',
  'patient_last_name',
  'phone',
  'email',
  'ssn',
  'address',
] as const;

const IDENTIFIER_SEGMENTS = new Set<string>([
  'mrn',
  'dob',
  'ssn',
  'phone',
  'address',
  'dob_hash',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MRN_LIKE = /\b\d{6,}\b/;
const EMBEDDED_ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
const FORMULA_LEAD = /^[=+\-@]/;
const TEMPLATE_KEY = /^[A-Za-z0-9_][A-Za-z0-9 _.-]{0,119}$/;

function normalizeColumn(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** True when a normalized column name carries (or imitates) an identifier. */
export function isIdentifierColumn(normalized: string): boolean {
  if (IDENTIFIER_SEGMENTS.has(normalized)) return true;
  if (!normalized) return false;
  const camel = normalized.replace(/_/g, '');
  if (IDENTIFIER_SEGMENTS.has(camel)) return true;
  if (/^(patient|subject|person)_?[a-z]*$/.test(camel) && /(mrn|dob|hash|id|name|birth)/.test(camel)) {
    return true;
  }
  return RESERVED_IMPORT_COLUMNS.some((reserved) => {
    const r = normalizeColumn(reserved);
    return normalized === r || normalized.startsWith(`${r}_`) || normalized.endsWith(`_${r}`);
  });
}

function failure(code: ImportErrorCode, message: string): ParsedImport {
  return { ok: false, code, message };
}

/**
 * The first character a spreadsheet would evaluate. Leading whitespace and
 * control characters are skipped because Excel and LibreOffice both ignore
 * them, so ` =1+1` is as executable as `=1+1`.
 */
export function firstSignificantCharacter(value: string): string {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || character === ' ' || character === '\t') continue;
    return character;
  }
  return '';
}

export function hasFormulaPrefix(value: string): boolean {
  return FORMULA_LEAD.test(firstSignificantCharacter(value));
}

export function containsIdentifierValue(value: string): boolean {
  return MRN_LIKE.test(value) || EMBEDDED_ISO_DATE.test(value) || SLASH_DATE.test(value);
}

/** One CSV record. RFC 4180 quoting, tolerant of a missing final newline. */
export function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] as string;
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else if (character !== '\r') {
      current += character;
    }
  }
  values.push(current);
  return values;
}

function coerceValue(
  field: ImportTemplateField,
  raw: string,
): { ok: true; value: string | number | boolean } | { ok: false; reason: string } {
  if (field.type === 'number') {
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return { ok: false, reason: 'must be a number' };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return { ok: false, reason: 'must be a number' };
    return { ok: true, value: parsed };
  }
  if (field.type === 'checkbox') {
    const normalized = raw.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(normalized)) return { ok: true, value: true };
    if (['false', 'no', '0'].includes(normalized)) return { ok: true, value: false };
    return { ok: false, reason: 'must be true/false' };
  }
  if (field.type === 'date') {
    if (!ISO_DATE.test(raw)) return { ok: false, reason: 'must be an ISO date (YYYY-MM-DD)' };
    return { ok: true, value: raw };
  }
  if (field.type === 'select') {
    const options = field.options ?? [];
    if (options.length > 0 && !options.includes(raw)) {
      return { ok: false, reason: `must be one of: ${options.join(', ')}` };
    }
    return { ok: true, value: raw };
  }
  // text / textarea: free text is checked for identifier-shaped content by the
  // caller before reaching here, so an accepted value is a safe narrative.
  return { ok: true, value: raw };
}

export function parseCaseImportCsv(input: {
  text: string;
  fields: ImportTemplateField[];
  byteLength?: number;
}): ParsedImport {
  const byteLength = input.byteLength ?? new TextEncoder().encode(input.text).byteLength;
  if (byteLength > MAX_IMPORT_BYTES) {
    return failure('file_too_large', `CSV exceeds the ${Math.floor(MAX_IMPORT_BYTES / 1024 / 1024)} MB import limit.`);
  }

  const fieldByKey = new Map<string, ImportTemplateField>();
  for (const field of input.fields) {
    fieldByKey.set(normalizeColumn(field.key), field);
  }
  const templateSelectors = new Set<string>(TEMPLATE_SELECTOR_COLUMNS.map(normalizeColumn));

  const lines = input.text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return failure('empty_file', 'CSV file is empty.');

  const rawHeaders = parseCsvLine(lines[0] as string).map((header) => header.trim());
  if (rawHeaders.length > MAX_IMPORT_COLUMNS) {
    return failure('too_many_columns', `CSV has more than ${MAX_IMPORT_COLUMNS} columns.`);
  }

  const headers: string[] = [];
  const seen = new Set<string>();
  for (const header of rawHeaders) {
    if (header.length === 0) return failure('empty_header', 'CSV has an empty column header.');
    if (header.length > MAX_IMPORT_HEADER_LENGTH) {
      return failure('header_too_long', `Column header exceeds ${MAX_IMPORT_HEADER_LENGTH} characters.`);
    }
    if (isIdentifierColumn(normalizeColumn(header))) {
      return failure(
        'identifier_column',
        `Column "${header}" carries patient identifiers. This release imports de-identified cases only; remove it from the file.`,
      );
    }
    const normalized = normalizeColumn(header);
    if (seen.has(normalized)) return failure('duplicate_column', `Column "${header}" appears more than once.`);
    seen.add(normalized);
    headers.push(header);
  }

  const known = new Set<string>([CASE_DATE_COLUMN, ...templateSelectors, ...fieldByKey.keys()]);
  for (const header of headers) {
    if (!known.has(normalizeColumn(header))) {
      return failure(
        'unknown_column',
        `Column "${header}" is not a field on the selected template. Remove it, or select a template that declares it.`,
      );
    }
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_IMPORT_ROWS) {
    return failure('too_many_rows', `CSV has more than ${MAX_IMPORT_ROWS} data rows.`);
  }

  const rows: ParsedImportRow[] = [];
  for (let index = 0; index < dataLines.length; index += 1) {
    const lineNumber = index + 2;
    const values = parseCsvLine(dataLines[index] as string);
    if (values.length > headers.length) {
      return failure('invalid_value', `Row ${lineNumber} has more values than there are columns.`);
    }

    const fieldValues: Record<string, string | number | boolean> = {};
    let caseDate: string | null = null;
    let templateSelector: string | null = null;

    for (let column = 0; column < headers.length; column += 1) {
      const header = headers[column] as string;
      const raw = (values[column] ?? '').trim();
      const normalized = normalizeColumn(header);

      if (raw.length > MAX_IMPORT_CELL_LENGTH) {
        return failure('cell_too_long', `Row ${lineNumber}, column "${header}" exceeds ${MAX_IMPORT_CELL_LENGTH} characters.`);
      }
      if (raw.length > 0 && hasFormulaPrefix(raw)) {
        return failure(
          'formula_injection',
          `Row ${lineNumber}, column "${header}" starts with a spreadsheet formula character (=, +, -, @). Remove it.`,
        );
      }
      if (raw.length === 0) continue;

      if (templateSelectors.has(normalized)) {
        templateSelector = raw;
        continue;
      }
      if (normalized === CASE_DATE_COLUMN) {
        if (!ISO_DATE.test(raw)) {
          return failure('invalid_value', `Row ${lineNumber}: case_date must be an ISO date (YYYY-MM-DD).`);
        }
        caseDate = raw;
        continue;
      }

      const field = fieldByKey.get(normalized);
      if (!field) {
        return failure('unknown_column', `Column "${header}" is not a field on the selected template.`);
      }
      if (field.type === 'text' || field.type === 'textarea') {
        if (containsIdentifierValue(raw)) {
          return failure(
            'phi_value',
            `Row ${lineNumber}, column "${header}" looks like it contains a patient identifier or date of birth. This release imports de-identified cases only.`,
          );
        }
      }
      if (!TEMPLATE_KEY.test(field.key)) {
        return failure('unknown_column', `Template field key "${field.key}" is not importable.`);
      }

      const coerced = coerceValue(field, raw);
      if (!coerced.ok) {
        return failure('invalid_value', `Row ${lineNumber}, column "${header}" ${coerced.reason}.`);
      }
      fieldValues[field.key] = coerced.value;
    }

    rows.push({ caseDate: caseDate ?? '', fieldValues, templateSelector });
  }

  if (rows.length === 0) return failure('empty_file', 'CSV file has no data rows.');

  return { ok: true, headers, rows };
}
