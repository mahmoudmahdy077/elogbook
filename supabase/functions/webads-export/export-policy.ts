/**
 * WebADS (ACGME) export policy — default-deny PHI egress.
 *
 * The WebADS feed is an *external vendor* submission. Historically this
 * function exported resident full names, patient MRNs, patient DOBs and the
 * entire free-text `field_values` blob, and it included `pending` (unapproved)
 * cases. All of that is PHI egress by default.
 *
 * This module makes the export fail closed:
 *   1. No configured vendor  -> 501. Nothing leaves the system.
 *   2. No approved vendor payload policy -> 403.
 *   3. The caller must explicitly confirm the de-identified mode.
 *   4. The caller must be an active, AAL2 director/institution_admin/admin of
 *      the same tenant.
 *   5. Only `approved`, non-deleted cases are selected, and the query never
 *      selects an identifier column at all.
 *   6. The emitted document carries an opaque per-export resident surrogate, the
 *      template name/specialty and dates. It contains no name, MRN, DOB or
 *      free text.
 *
 * This module is intentionally dependency-free so the policy is unit-testable
 * with `deno test --frozen --no-config --allow-read`.
 */

export const WEBADS_EXPORT_ROLES = ['director', 'institution_admin', 'admin'] as const;

export const WEBADS_PAYLOAD_POLICY = 'metadata_only' as const;

export const WEBADS_MAX_RESIDENT_IDS = 500;
export const WEBADS_MAX_ROWS = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface WebadsPrincipal {
  role: string;
  profileId: string;
  tenantId: string;
  aal: 'aal1' | 'aal2';
  profileStatus: string;
  tenantStatus: string;
}

/**
 * Vendor posture, resolved server-side. `vendorEnabled` comes from deployment
 * configuration; `approvedPolicy` is the policy that has been signed off for
 * this vendor. There is deliberately no "phi" option.
 */
export interface WebadsVendorPolicy {
  vendorEnabled: boolean;
  approvedPolicy: string | null;
}

export interface WebadsRequestBody {
  tenant_id?: unknown;
  resident_ids?: unknown;
  date_from?: unknown;
  date_to?: unknown;
  deidentified_confirmed?: unknown;
}

export type WebadsAuthorization =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 501; error: string };

export interface WebadsRawRow {
  id: string;
  resident_id: string;
  case_date: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  patient_mrn?: unknown;
  patient_dob?: unknown;
  field_values?: unknown;
  profiles?: { id?: string; full_name?: unknown; specialty?: unknown } | unknown;
  case_templates?: { id?: string; name?: unknown; specialty?: unknown } | unknown;
}

export interface WebadsEntry {
  entryId: string;
  residentRef: string;
  caseDate: string;
  status: string;
  templateId: string;
  templateName: string;
  specialty: string;
  createdAt: string;
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function authorizeWebadsExport(input: {
  principal: WebadsPrincipal;
  policy: WebadsVendorPolicy;
  body: WebadsRequestBody;
}): WebadsAuthorization {
  const { principal, policy, body } = input;

  // 1. Default deny: no external vendor configured means no export.
  if (policy.vendorEnabled !== true) {
    return { ok: false, status: 501, error: 'external_export_not_enabled' };
  }

  // 2. Default deny: a vendor without an approved payload policy is not called.
  if (policy.approvedPolicy !== WEBADS_PAYLOAD_POLICY) {
    return { ok: false, status: 403, error: 'vendor_phi_policy_required' };
  }

  // 3. The request must explicitly opt into the de-identified mode.
  if (body?.deidentified_confirmed !== true) {
    return { ok: false, status: 403, error: 'deidentified_confirmation_required' };
  }

  // 4. Server-side authorization: active scope, privileged role, AAL2.
  if (
    principal.profileStatus !== 'active'
    || principal.tenantStatus !== 'active'
    || principal.aal !== 'aal2'
    || !(WEBADS_EXPORT_ROLES as readonly string[]).includes(principal.role)
  ) {
    return { ok: false, status: 403, error: 'forbidden' };
  }

  if (body.tenant_id !== principal.tenantId) {
    return { ok: false, status: 403, error: 'tenant_mismatch' };
  }

  // 5. Request shape.
  const residentIds = body.resident_ids;
  if (!Array.isArray(residentIds) || residentIds.length === 0) {
    return { ok: false, status: 400, error: 'resident_ids_required' };
  }
  if (!residentIds.every((id) => isUuid(id))) {
    return { ok: false, status: 400, error: 'resident_ids_invalid' };
  }
  if (residentIds.length > WEBADS_MAX_RESIDENT_IDS) {
    return { ok: false, status: 400, error: 'too_many_residents' };
  }

  for (const value of [body.date_from, body.date_to]) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
      return { ok: false, status: 400, error: 'date_range_invalid' };
    }
  }

  return { ok: true };
}

export interface WebadsQuerySpec {
  tenantId: string;
  residentIds: string[];
  dateFrom: string | null;
  dateTo: string | null;
  status: string[];
  onlyNotDeleted: boolean;
  limit: number;
  select: string;
}

/**
 * The columns the export is allowed to read. An identifier column is absent by
 * construction, so a future refactor cannot accidentally widen the projection.
 */
export const WEBADS_EXPORT_SELECT = [
  'id',
  'resident_id',
  'case_date',
  'status',
  'created_at',
  'updated_at',
  'case_templates!inner(id, name, specialty)',
].join(', ');

export function buildWebadsExportQuerySpec(input: {
  tenantId: string;
  residentIds: string[];
  dateFrom: string | null;
  dateTo: string | null;
}): WebadsQuerySpec {
  return {
    tenantId: input.tenantId,
    residentIds: [...input.residentIds],
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    status: ['approved'],
    onlyNotDeleted: true,
    limit: WEBADS_MAX_ROWS,
    select: WEBADS_EXPORT_SELECT,
  };
}

/**
 * Project raw rows onto the opaque de-identified entry shape. Residents are
 * replaced by a stable per-export surrogate (`R1`, `R2`, …) so the recipient
 * can count distinct residents without learning who they are.
 */
export function projectWebadsEntries(rows: readonly WebadsRawRow[]): WebadsEntry[] {
  const residentRefs = new Map<string, string>();

  return rows.map((row) => {
    const residentId = text(row.resident_id);
    let ref = residentRefs.get(residentId);
    if (ref === undefined) {
      ref = `R${residentRefs.size + 1}`;
      residentRefs.set(residentId, ref);
    }

    const template = asRecord(
      Array.isArray(row.case_templates) ? (row.case_templates as unknown[])[0] : row.case_templates,
    );

    return {
      entryId: text(row.id),
      residentRef: ref,
      caseDate: text(row.case_date),
      status: text(row.status),
      templateId: text(template.id),
      templateName: text(template.name),
      specialty: text(template.specialty),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildWebadsXml(input: {
  tenantId: string;
  dateFrom: string | null;
  dateTo: string | null;
  generatedAt: string;
  entries: readonly WebadsEntry[];
}): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<WebADSExport xmlns="http://www.acgme.org/WebADS" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.acgme.org/WebADS WebADS.xsd">\n';
  xml += '  <ExportMetadata>\n';
  xml += `    <GeneratedAt>${escapeXml(input.generatedAt)}</GeneratedAt>\n`;
  xml += `    <TenantId>${escapeXml(input.tenantId)}</TenantId>\n`;
  xml += `    <DateFrom>${escapeXml(input.dateFrom ?? '')}</DateFrom>\n`;
  xml += `    <DateTo>${escapeXml(input.dateTo ?? '')}</DateTo>\n`;
  xml += `    <RecordCount>${input.entries.length}</RecordCount>\n`;
  xml += `    <PayloadPolicy>${WEBADS_PAYLOAD_POLICY}</PayloadPolicy>\n`;
  xml += '    <System>E-Logbook</System>\n';
  xml += '    <Version>2.0</Version>\n';
  xml += '  </ExportMetadata>\n';
  xml += '  <CaseEntries>\n';

  for (const entry of input.entries) {
    xml += '    <CaseEntry>\n';
    xml += `      <EntryId>${escapeXml(entry.entryId)}</EntryId>\n`;
    xml += `      <CaseDate>${escapeXml(entry.caseDate)}</CaseDate>\n`;
    xml += '      <Resident>\n';
    xml += `        <ResidentRef>${escapeXml(entry.residentRef)}</ResidentRef>\n`;
    xml += '      </Resident>\n';
    xml += '      <Template>\n';
    xml += `        <TemplateId>${escapeXml(entry.templateId)}</TemplateId>\n`;
    xml += `        <TemplateName>${escapeXml(entry.templateName)}</TemplateName>\n`;
    xml += `        <Specialty>${escapeXml(entry.specialty)}</Specialty>\n`;
    xml += '      </Template>\n';
    xml += `      <Status>${escapeXml(entry.status)}</Status>\n`;
    xml += `      <CreatedAt>${escapeXml(entry.createdAt)}</CreatedAt>\n`;
    xml += `      <UpdatedAt>${escapeXml(entry.updatedAt)}</UpdatedAt>\n`;
    xml += '    </CaseEntry>\n';
  }

  xml += '  </CaseEntries>\n';
  xml += '</WebADSExport>\n';

  return xml;
}
