import { describe, it, expect } from 'vitest';
import { buildCasePayload } from '../case-payload';

describe('buildCasePayload', () => {
  it('nulls out PHI when deidentified and carries the hash', () => {
    const p = buildCasePayload({
      tenantId: 't1', residentId: 'r1', templateId: 'tmpl1',
      patientMrn: '123456', patientDob: '1990-01-01', patientAge: '34',
      caseDate: '2026-08-12', fieldValues: { procedure: 'appendectomy' },
      isDeidentified: true, status: 'pending', patientHash: null,
    });
    expect(p.patient_mrn).toBeNull();
    expect(p.patient_dob).toBeNull();
    expect(p.patient_hash).toBeNull();
    expect(p.patient_age_years).toBe(34);
  });
  it('keeps PHI when identified', () => {
    const p = buildCasePayload({
      tenantId: 't1', residentId: 'r1', templateId: 'tmpl1',
      patientMrn: '123456', patientDob: '1990-01-01', patientAge: '',
      caseDate: '2026-08-12', fieldValues: {}, isDeidentified: false,
      status: 'draft', patientHash: 'h4sh',
    });
    expect(p.patient_mrn).toBe('123456');
    expect(p.patient_hash).toBe('h4sh');
    expect(p.patient_age_years).toBeNull();
  });
});
