/**
 * Resident create-then-submit flow for the clinical core slice.
 *
 * The UI never chooses a clinical status. It always writes a draft, then hands
 * the transition to the `submit_case` command, which owns the state machine,
 * the approval requests, the audit row and the outbox row in one transaction
 * (docs/superpowers/specs/2026-09-23-clinical-core-remediation-design.md,
 * sections 6.1 and 6.3).
 *
 * A tenant with no eligible reviewer is not an error the resident caused: the
 * case stays a draft and the caller gets a `draft_only` outcome it can render
 * as actionable feedback.
 */

export interface CaseDraftInput {
  templateId: string;
  caseDate: string;
  fieldValues: Record<string, unknown>;
  accreditationMappings: unknown[];
  isDeidentified: boolean;
  patientColumns: Record<string, unknown>;
  tenantId: string;
  residentId: string;
  requestId: string;
}

export interface InsertDraftResult {
  id: string | null;
  error: string | null;
}

export interface SubmitCommandResult {
  status: number;
  body: { success?: boolean; case_id?: string; code?: string } | null;
}

export interface SubmitFlowDeps {
  insertDraft: (row: Record<string, unknown>) => Promise<InsertDraftResult>;
  submitCommand: (args: {
    caseId: string;
    requestId: string;
    expectedStatus: string;
  }) => Promise<SubmitCommandResult>;
}

export type SubmitOutcome =
  | { outcome: 'submitted'; caseId: string }
  | { outcome: 'draft_only'; caseId: string; code: string }
  | { outcome: 'error'; message: string };

export function caseDraftPath(tenantSlug: string): string {
  return `/api/${tenantSlug}/cases`;
}

export function caseSubmitPath(tenantSlug: string, caseId: string): string {
  return `/api/${tenantSlug}/cases/${caseId}/submit`;
}

export function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveCaseDraft(
  tenantSlug: string,
  row: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<InsertDraftResult & { code?: string }> {
  if (row.is_deidentified !== true) {
    return {
      id: null,
      error: 'Identifiable case entry is not available in this release.',
      code: 'policy_denied',
    };
  }

  const payload = {
    request_id: String(row.request_id ?? newRequestId()),
    template_id: String(row.template_id ?? ''),
    case_date: String(row.case_date ?? ''),
    field_values: row.field_values && typeof row.field_values === 'object'
      ? row.field_values
      : {},
    accreditation_mappings: Array.isArray(row.accreditation_mappings)
      ? row.accreditation_mappings
      : [],
    is_deidentified: true as const,
    patient_age_years: typeof row.patient_age_years === 'number'
      ? row.patient_age_years
      : null,
  };

  try {
    const response = await fetcher(caseDraftPath(tenantSlug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null) as {
      success?: boolean;
      case_id?: string;
      error?: string;
      code?: string;
    } | null;

    if (!response.ok || body?.success !== true || !body.case_id) {
      return {
        id: null,
        error: body?.error ?? `Draft creation failed (${response.status}).`,
        code: body?.code ?? 'draft_failed',
      };
    }

    return { id: body.case_id, error: null };
  } catch {
    return { id: null, error: 'The case draft could not be saved.', code: 'network_error' };
  }
}

export async function createCaseDraftAndSubmit(
  deps: SubmitFlowDeps,
  input: CaseDraftInput,
): Promise<SubmitOutcome> {
  const inserted = await deps.insertDraft({
    request_id: input.requestId,
    tenant_id: input.tenantId,
    resident_id: input.residentId,
    template_id: input.templateId,
    case_date: input.caseDate,
    field_values: input.fieldValues,
    accreditation_mappings: input.accreditationMappings,
    is_deidentified: input.isDeidentified,
    ...input.patientColumns,
    // Always a draft. The command owns every transition out of it.
    status: 'draft',
  });

  if (inserted.error) {
    return { outcome: 'error', message: inserted.error };
  }
  if (!inserted.id) {
    return { outcome: 'error', message: 'The case draft could not be saved.' };
  }

  const command = await deps.submitCommand({
    caseId: inserted.id,
    requestId: input.requestId,
    expectedStatus: 'draft',
  });

  if (command.status === 200 && command.body?.success === true) {
    return { outcome: 'submitted', caseId: inserted.id };
  }

  const code = command.body?.code ?? 'submit_failed';
  return { outcome: 'draft_only', caseId: inserted.id, code };
}
