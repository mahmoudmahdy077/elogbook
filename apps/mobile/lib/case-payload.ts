export interface CaseContentInput {
  templateId: string;
  patientMrn: string;
  patientDob: string;
  patientAge: string;
  caseDate: string;
  fieldValues: Record<string, string>;
  isDeidentified: boolean;
  patientHash: string | null;
}

/**
 * The clinical content columns, and nothing else.
 *
 * `tenant_id`, `resident_id` and `status` are server-owned: the first two are
 * resolved from the request principal by the command boundary, and the third is
 * the state machine's. A payload carrying them is either refused by the
 * operation RPC's allowlist or, worse, reads as a client reaching for a
 * transition it does not own.
 *
 * `patient_hash` is omitted here because the edit path may not rewrite it (the
 * operation RPC treats it as an immutable column). The insert path adds it back
 * through `withPatientHash`, which is the one place a hash is first derived.
 */
export function buildCaseContent(input: CaseContentInput): Record<string, unknown> {
  return {
    template_id: input.templateId,
    case_date: input.caseDate,
    field_values: input.fieldValues,
    is_deidentified: input.isDeidentified,
    patient_age_years: input.isDeidentified ? Number(input.patientAge) || null : null,
    patient_mrn: input.isDeidentified ? null : input.patientMrn,
    patient_dob: input.isDeidentified ? null : input.patientDob,
  };
}

/** First-write-only: the MRN hash a de-identified boundary forbids re-deriving. */
export function withPatientHash(
  content: Record<string, unknown>,
  patientHash: string | null,
): Record<string, unknown> {
  return patientHash ? { ...content, patient_hash: patientHash } : content;
}
