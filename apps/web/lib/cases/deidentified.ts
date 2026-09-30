/**
 * De-identified patient columns for the clinical core slice.
 *
 * Design non-goal (docs/superpowers/specs/2026-09-23-clinical-core-remediation-design.md
 * section 3): this slice does not expose MRN, DOB, or `patient_hash`
 * generation. The de-identified path therefore carries the approved synthetic
 * field only -- the age in years -- and must never hash a placeholder value.
 *
 * Identifiable capture stays behind the tenant data-mode policy and is handled
 * by the identified branch in the callers.
 */
export interface DeidentifiedPatientColumns {
  patient_mrn: null;
  patient_dob: null;
  patient_age_years: number | null;
}

export function buildDeidentifiedPatientColumns(
  ageYears: string | number | null | undefined,
): DeidentifiedPatientColumns {
  const parsed = typeof ageYears === 'number' ? ageYears : Number(String(ageYears ?? '').trim());
  const normalized = Number.isFinite(parsed) && String(ageYears ?? '').trim() !== '' ? parsed : null;

  return {
    patient_mrn: null,
    patient_dob: null,
    patient_age_years: normalized,
  };
}
