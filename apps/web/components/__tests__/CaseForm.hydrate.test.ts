import { describe, it, expect, vi } from 'vitest';
import { hydrateDuplicateCase } from '../CaseForm';

describe('hydrateDuplicateCase', () => {
  const makeSetters = () => ({
    setSelectedTemplateId: vi.fn(),
    setIsDeidentified: vi.fn(),
    setPatientMrn: vi.fn(),
    setPatientDob: vi.fn(),
    setPatientAgeYears: vi.fn(),
    setCaseDate: vi.fn(),
    setFieldValues: vi.fn(),
    setAccreditationMappings: vi.fn(),
  });

  it('pre-fills template and non-PHI fields from source', () => {
    const source = {
      template_id: 'tpl-1',
      is_deidentified: true,
      patient_age_years: 34,
      field_values: { diagnosis: 'Hypertension' },
      accreditation_mappings: [{ framework_id: 'fw-1', milestone_code: 'M1', competency_area: 'PC' }],
    };
    const setters = makeSetters();
    hydrateDuplicateCase(source, setters);

    expect(setters.setSelectedTemplateId).toHaveBeenCalledWith('tpl-1');
    expect(setters.setIsDeidentified).toHaveBeenCalledWith(true);
    expect(setters.setPatientAgeYears).toHaveBeenCalledWith('34');
    expect(setters.setFieldValues).toHaveBeenCalledWith({ diagnosis: 'Hypertension' });
    expect(setters.setAccreditationMappings).toHaveBeenCalledWith([
      { framework_id: 'fw-1', milestone_code: 'M1', competency_area: 'PC' },
    ]);
  });

  it('resets patient_mrn and patient_dob to empty strings', () => {
    const source = {
      template_id: 'tpl-1',
      is_deidentified: false,
      patient_mrn: 'MRN-98765',
      patient_dob: '1990-01-15',
      field_values: {},
    };
    const setters = makeSetters();
    hydrateDuplicateCase(source, setters);

    expect(setters.setPatientMrn).toHaveBeenCalledWith('');
    expect(setters.setPatientDob).toHaveBeenCalledWith('');
  });

  it('resets patient_mrn and patient_dob regardless of source values', () => {
    const source = {
      template_id: 'tpl-1',
      is_deidentified: false,
      patient_mrn: null,
      patient_dob: null,
      field_values: {},
    };
    const setters = makeSetters();
    hydrateDuplicateCase(source, setters);

    expect(setters.setPatientMrn).toHaveBeenCalledWith('');
    expect(setters.setPatientDob).toHaveBeenCalledWith('');
  });

  it('sets patient_age_years to empty string when null', () => {
    const source = {
      template_id: 'tpl-1',
      is_deidentified: true,
      patient_age_years: null,
      field_values: {},
    };
    const setters = makeSetters();
    hydrateDuplicateCase(source, setters);

    expect(setters.setPatientAgeYears).toHaveBeenCalledWith('');
  });

  it('sets case_date to today (not from source)', () => {
    const source = {
      template_id: 'tpl-1',
      is_deidentified: true,
      case_date: '2025-06-01',
      field_values: {},
    };
    const setters = makeSetters();
    hydrateDuplicateCase(source, setters);

    const today = new Date().toISOString().slice(0, 10);
    expect(setters.setCaseDate).toHaveBeenCalledWith(today);
  });

  it('never passes patient_hash to any setter', () => {
    const source = {
      template_id: 'tpl-1',
      is_deidentified: true,
      patient_hash: 'hash-abc-123',
      field_values: {},
    };
    const setters = makeSetters();
    hydrateDuplicateCase(source, setters);

    const allSetters = Object.values(setters) as ReturnType<typeof vi.fn>[];
    for (const fn of allSetters) {
      expect(fn).not.toHaveBeenCalledWith('hash-abc-123');
    }
  });
});
