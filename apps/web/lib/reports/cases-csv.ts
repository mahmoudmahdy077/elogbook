import { escapeCsvCell } from '@/lib/csv';

export interface CaseExportRow {
  id: string;
  case_date: string;
  status: string;
  patient_mrn?: string | null;
  case_templates: { name: string; specialty: string } | { name: string; specialty: string }[];
}

/** The only case status a client-side export may contain. */
export const EXPORTABLE_STATUSES = ['approved'] as const;

const HEADERS = ['Case Date', 'Template', 'Specialty', 'Status'] as const;

function template(row: CaseExportRow): { name: string; specialty: string } {
  const value = Array.isArray(row.case_templates) ? row.case_templates[0] : row.case_templates;
  return { name: value?.name ?? '', specialty: value?.specialty ?? '' };
}

/**
 * Approved-only projection for the case-list CSV export.
 *
 * The export used to include a `patient_mrn` column and every status, so a
 * user-triggered download released patient identifiers and unapproved case
 * data to a file with no audit record. The projection is metadata only.
 */
export function exportableCaseRows(entries: readonly CaseExportRow[]): CaseExportRow[] {
  return entries.filter((entry) => (EXPORTABLE_STATUSES as readonly string[]).includes(entry.status));
}

export function buildCasesCsv(entries: readonly CaseExportRow[]): string {
  const lines = [HEADERS.join(',')];
  for (const row of exportableCaseRows(entries)) {
    const { name, specialty } = template(row);
    lines.push([row.case_date, name, specialty, row.status].map(escapeCsvCell).join(','));
  }
  return lines.join('\n');
}
