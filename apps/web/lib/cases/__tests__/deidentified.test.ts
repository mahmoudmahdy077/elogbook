import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDeidentifiedPatientColumns } from '../deidentified';

const repoRoot = resolve(process.cwd(), '..', '..');
const caseForm = readFileSync(resolve(repoRoot, 'apps/web/components/CaseForm.tsx'), 'utf8');
const quickAddCase = readFileSync(resolve(repoRoot, 'apps/web/components/QuickAddCase.tsx'), 'utf8');

describe('de-identified case patient columns', () => {
  it('exposes only the approved age field', () => {
    const columns = buildDeidentifiedPatientColumns('34');

    expect(columns).toEqual({ patient_mrn: null, patient_dob: null, patient_age_years: 34 });
  });

  it('never produces a patient_hash', () => {
    const columns = buildDeidentifiedPatientColumns('34');

    expect(Object.keys(columns)).not.toContain('patient_hash');
    expect(JSON.stringify(columns)).not.toContain('patient_hash');
  });

  it('never carries an MRN or date of birth into a de-identified case', () => {
    const columns = buildDeidentifiedPatientColumns('34');

    expect(columns.patient_mrn).toBeNull();
    expect(columns.patient_dob).toBeNull();
  });

  it('normalizes a blank age to null instead of NaN', () => {
    expect(buildDeidentifiedPatientColumns('').patient_age_years).toBeNull();
    expect(buildDeidentifiedPatientColumns('   ').patient_age_years).toBeNull();
  });

  it('normalizes a non-numeric age to null', () => {
    expect(buildDeidentifiedPatientColumns('abc').patient_age_years).toBeNull();
  });

  it('accepts an already-parsed age', () => {
    expect(buildDeidentifiedPatientColumns(41).patient_age_years).toBe(41);
  });
});

describe('de-identified flow has no patient-hash generation', () => {
  // Design non-goal (spec section 3): this slice does not expose MRN, DOB, or
  // patient_hash generation. The de-identified path must not hash a synthetic
  // stand-in value either.
  it('CaseForm never calls the hash_patient_mrn RPC', () => {
    expect(caseForm).not.toContain('hash_patient_mrn');
  });

  it('CaseForm never writes a patient_hash column', () => {
    expect(caseForm).not.toContain('patient_hash');
  });

  it('QuickAddCase never calls the hash_patient_mrn RPC', () => {
    expect(quickAddCase).not.toContain('hash_patient_mrn');
  });

  it('QuickAddCase never writes a patient_hash column', () => {
    expect(quickAddCase).not.toContain('patient_hash');
  });
});
