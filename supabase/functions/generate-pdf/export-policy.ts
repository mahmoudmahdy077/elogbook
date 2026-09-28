/**
 * generate-pdf scope policy — the documented single-resident supervisor scope.
 *
 * The PDF report is a clinical document. It is only ever produced for one
 * resident, by a supervisor/director/institution_admin/admin of that resident's
 * own tenant, at AAL2, for that resident's approved, non-deleted cases.
 *
 * Previously the endpoint accepted a client-supplied `resident_name` (which was
 * then drawn into the document), accepted any privileged role for any case ids
 * in the tenant, selected `field_values` it never used, and wrote an audit row
 * with a comma-joined `resource_id` that could never be stored.
 *
 * This module is intentionally dependency-free so the policy is unit-testable
 * with `deno test --frozen --no-config --allow-read`.
 */

export const PDF_SCOPE_ROLES = ['supervisor', 'director', 'institution_admin', 'admin'] as const;

export const PDF_MAX_CASE_IDS = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PdfPrincipal {
  role: string;
  profileId: string;
  tenantId: string;
  aal: 'aal1' | 'aal2';
  profileStatus: string;
  tenantStatus: string;
}

export interface PdfRequestBody {
  case_ids?: unknown;
  resident_id?: unknown;
  resident_name?: unknown;
}

export type PdfAuthorization =
  | { ok: true; residentId: string; caseIds: string[] }
  | { ok: false; status: 400 | 403; error: string };

export interface PdfRow {
  id: string;
  resident_id: string;
  tenant_id: string;
  status: string;
  case_date: string | null;
  deleted_at: string | null;
  field_values?: unknown;
  case_templates?: { name?: unknown; specialty?: unknown } | unknown;
}

export interface PdfReportRow {
  caseDate: string;
  templateName: string;
  specialty: string;
}

export type PdfReportRows =
  | { ok: true; rows: PdfReportRow[] }
  | { ok: false; reason: 'resident_scope_violation' | 'no_exportable_cases' };

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function authorizePdfScope(input: {
  principal: PdfPrincipal;
  body: PdfRequestBody;
}): PdfAuthorization {
  const { principal, body } = input;

  if (
    principal.profileStatus !== 'active'
    || principal.tenantStatus !== 'active'
    || principal.aal !== 'aal2'
    || !(PDF_SCOPE_ROLES as readonly string[]).includes(principal.role)
  ) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  // The resident label is resolved server-side from the tenant-scoped profile; a
  // caller may not assert a name into a clinical document.
  if (body?.resident_name !== undefined && body.resident_name !== null) {
    return { ok: false, status: 400, error: 'resident_name_not_accepted' };
  }

  if (body?.resident_id === undefined || body.resident_id === null) {
    return { ok: false, status: 400, error: 'resident_id_required' };
  }
  if (!isUuid(body.resident_id)) {
    return { ok: false, status: 400, error: 'resident_id_invalid' };
  }
  const residentId = body.resident_id;

  const caseIds = body?.case_ids;
  if (!Array.isArray(caseIds) || caseIds.length === 0) {
    return { ok: false, status: 400, error: 'case_ids_required' };
  }
  if (caseIds.length > PDF_MAX_CASE_IDS) {
    return { ok: false, status: 400, error: 'too_many_cases' };
  }
  if (!caseIds.every((id) => isUuid(id))) {
    return { ok: false, status: 400, error: 'case_ids_invalid' };
  }

  return { ok: true, residentId, caseIds: caseIds as string[] };
}

/**
 * Narrow the fetched rows to the single authorized resident and project away
 * every column the report does not render. A row belonging to another resident
 * or tenant is a scope violation, not a filter: the request asked for someone
 * else's chart and must fail closed rather than silently return less data.
 */
export function buildPdfReportRows(input: {
  rows: readonly PdfRow[];
  residentId: string;
  tenantId: string;
}): PdfReportRows {
  for (const row of input.rows) {
    if (row.resident_id !== input.residentId || row.tenant_id !== input.tenantId) {
      return { ok: false, reason: 'resident_scope_violation' };
    }
  }

  const rows = input.rows
    .filter((row) => row.status === 'approved' && row.deleted_at === null)
    .map((row) => {
      const template = asRecord(
        Array.isArray(row.case_templates) ? (row.case_templates as unknown[])[0] : row.case_templates,
      );
      return {
        caseDate: text(row.case_date),
        templateName: text(template.name),
        specialty: text(template.specialty),
      };
    });

  if (rows.length === 0) return { ok: false, reason: 'no_exportable_cases' };
  return { ok: true, rows };
}
