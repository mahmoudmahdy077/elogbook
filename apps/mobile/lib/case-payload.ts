export interface CasePayloadInput {
  tenantId: string;
  residentId: string;
  templateId: string;
  patientMrn: string;
  patientDob: string;
  patientAge: string;
  caseDate: string;
  fieldValues: Record<string, string>;
  isDeidentified: boolean;
  status: 'pending' | 'draft';
  patientHash: string | null;
}

export function buildCasePayload(input: CasePayloadInput) {
  return {
    tenant_id: input.tenantId,
    resident_id: input.residentId,
    template_id: input.templateId,
    patient_mrn: input.isDeidentified ? null : input.patientMrn,
    patient_dob: input.isDeidentified ? null : input.patientDob,
    patient_age_years: input.isDeidentified ? Number(input.patientAge) || null : null,
    patient_hash: input.patientHash,
    case_date: input.caseDate,
    field_values: input.fieldValues,
    status: input.status,
    is_deidentified: input.isDeidentified,
  };
}
