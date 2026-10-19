import { describe, it, expect } from 'vitest';
import { buildCaseContent, withPatientHash } from '../case-payload';

const BASE = {
  templateId: 'tmpl1',
  patientMrn: '123456',
  patientDob: '1990-01-01',
  caseDate: '2026-08-12',
  fieldValues: { procedure: 'appendectomy' },
};

describe('buildCaseContent', () => {
  it('nulls out PHI when deidentified', () => {
    const p = buildCaseContent({
      ...BASE,
      patientAge: '34',
      isDeidentified: true,
      patientHash: 'h4sh',
    });
    expect(p.patient_mrn).toBeNull();
    expect(p.patient_dob).toBeNull();
    expect(p.patient_age_years).toBe(34);
    expect(p.template_id).toBe('tmpl1');
    expect(p.case_date).toBe('2026-08-12');
    expect(p.is_deidentified).toBe(true);
  });

  it('keeps PHI when identified and drops the age', () => {
    const p = buildCaseContent({
      ...BASE,
      patientAge: '34',
      isDeidentified: false,
      patientHash: 'h4sh',
    });
    expect(p.patient_mrn).toBe('123456');
    expect(p.patient_dob).toBe('1990-01-01');
    expect(p.patient_age_years).toBeNull();
    expect(p.is_deidentified).toBe(false);
  });

  it('never carries the identity or the status: the boundary owns both', () => {
    const p = buildCaseContent({
      ...BASE,
      patientAge: '34',
      isDeidentified: true,
      patientHash: null,
    });
    expect(Object.keys(p).sort()).toEqual([
      'case_date',
      'field_values',
      'is_deidentified',
      'patient_age_years',
      'patient_dob',
      'patient_mrn',
      'template_id',
    ]);
    expect(p).not.toHaveProperty('tenant_id');
    expect(p).not.toHaveProperty('resident_id');
    expect(p).not.toHaveProperty('status');
    // The hash is first-write-only: an edit may not rewrite it.
    expect(p).not.toHaveProperty('patient_hash');
  });

  it('reports a non-numeric age as null rather than NaN', () => {
    const p = buildCaseContent({ ...BASE, patientAge: '', isDeidentified: true, patientHash: null });
    expect(p.patient_age_years).toBeNull();
  });
});

describe('withPatientHash', () => {
  it('adds the hash only for a first write, and only when there is one', () => {
    const content = buildCaseContent({ ...BASE, patientAge: '34', isDeidentified: false, patientHash: 'h4sh' });
    expect(withPatientHash(content, 'h4sh')).toHaveProperty('patient_hash', 'h4sh');
    expect(withPatientHash(content, null)).not.toHaveProperty('patient_hash');
    expect(content).not.toHaveProperty('patient_hash');
  });
});
