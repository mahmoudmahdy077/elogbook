import { describe, it, expect } from 'vitest';
import {
  caseEntrySchema,
  caseEntryIdentifiedSchema,
  caseEntryDeidentifiedSchema,
  caseTemplateSchema,
  approvalActionSchema,
  programGoalSchema,
  accreditationFrameworkSchema,
  aiQuerySchema,
  residentAiToggleSchema,
  templateFieldSchema,
  accreditationMappingSchema,
} from '../cases';

describe('caseEntryIdentifiedSchema', () => {
  const validIdentified = {
    template_id: '123e4567-e89b-12d3-a456-426614174000',
    patient_mrn: 'MRN-12345',
    patient_dob: '1990-01-15',
    case_date: '2026-06-01',
    field_values: { diagnosis: 'Hypertension' },
    accreditation_mappings: [],
    is_deidentified: false,
  };

  it('should accept a valid identified case', () => {
    const result = caseEntryIdentifiedSchema.safeParse(validIdentified);
    expect(result.success).toBe(true);
  });

  it('should accept null MRN and DOB', () => {
    const result = caseEntryIdentifiedSchema.safeParse({
      ...validIdentified,
      patient_mrn: null,
      patient_dob: null,
    });
    expect(result.success).toBe(true);
  });

  it('should reject MRN exceeding 50 characters', () => {
    const result = caseEntryIdentifiedSchema.safeParse({
      ...validIdentified,
      patient_mrn: 'A'.repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-date case_date format', () => {
    const result = caseEntryIdentifiedSchema.safeParse({
      ...validIdentified,
      case_date: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing template_id', () => {
    const { template_id, ...rest } = validIdentified;
    const result = caseEntryIdentifiedSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe('caseEntryDeidentifiedSchema', () => {
  const validDeidentified = {
    template_id: '123e4567-e89b-12d3-a456-426614174000',
    patient_age_years: 35,
    patient_hash: 'abc123def456',
    case_date: '2026-06-01',
    field_values: { diagnosis: 'Hypertension' },
    accreditation_mappings: [],
    is_deidentified: true,
  };

  it('should accept a valid deidentified case', () => {
    const result = caseEntryDeidentifiedSchema.safeParse(validDeidentified);
    expect(result.success).toBe(true);
  });

  it('should reject negative age', () => {
    const result = caseEntryDeidentifiedSchema.safeParse({
      ...validDeidentified,
      patient_age_years: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject age over 150', () => {
    const result = caseEntryDeidentifiedSchema.safeParse({
      ...validDeidentified,
      patient_age_years: 200,
    });
    expect(result.success).toBe(false);
  });
});

describe('caseEntrySchema (discriminated union)', () => {
  it('should accept deidentified case', () => {
    const result = caseEntrySchema.safeParse({
      template_id: '123e4567-e89b-12d3-a456-426614174000',
      patient_age_years: 35,
      patient_hash: 'hash123',
      case_date: '2026-06-01',
      field_values: {},
      is_deidentified: true,
    });
    expect(result.success).toBe(true);
  });

  it('should accept identified case', () => {
    const result = caseEntrySchema.safeParse({
      template_id: '123e4567-e89b-12d3-a456-426614174000',
      patient_mrn: 'MRN-001',
      patient_dob: '1990-01-15',
      case_date: '2026-06-01',
      field_values: {},
      is_deidentified: false,
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing is_deidentified', () => {
    const result = caseEntrySchema.safeParse({
      template_id: '123e4567-e89b-12d3-a456-426614174000',
      case_date: '2026-06-01',
      field_values: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('templateFieldSchema', () => {
  it('should accept a valid text field', () => {
    const result = templateFieldSchema.safeParse({
      key: 'diagnosis',
      label: 'Diagnosis',
      type: 'text',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid field type', () => {
    const result = templateFieldSchema.safeParse({
      key: 'bad',
      label: 'Bad',
      type: 'radio',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty key', () => {
    const result = templateFieldSchema.safeParse({
      key: '',
      label: 'Empty',
      type: 'text',
    });
    expect(result.success).toBe(false);
  });
});

describe('caseTemplateSchema', () => {
  const validTemplate = {
    specialty: 'Cardiology',
    name: 'Chest Pain Workup',
    fields: [
      { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
      { key: 'ecg_findings', label: 'ECG Findings', type: 'textarea' },
    ],
    required_fields: ['diagnosis'],
  };

  it('should accept a valid template', () => {
    const result = caseTemplateSchema.safeParse(validTemplate);
    expect(result.success).toBe(true);
  });

  it('should reject template with empty fields array', () => {
    const result = caseTemplateSchema.safeParse({
      ...validTemplate,
      fields: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject template with empty name', () => {
    const result = caseTemplateSchema.safeParse({
      ...validTemplate,
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject required_fields that reference non-existent keys', () => {
    const result = caseTemplateSchema.safeParse({
      specialty: 'Cardiology',
      name: 'Test',
      fields: [
        { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
      ],
      required_fields: ['nonexistent_key'],
    });
    expect(result.success).toBe(false);
  });

  it('should accept required_fields that are a subset of field keys', () => {
    const result = caseTemplateSchema.safeParse({
      specialty: 'Cardiology',
      name: 'Test',
      fields: [
        { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      required_fields: ['diagnosis'],
    });
    expect(result.success).toBe(true);
  });
});

describe('approvalActionSchema', () => {
  it('should accept approve action', () => {
    const result = approvalActionSchema.safeParse({
      entry_id: '123e4567-e89b-12d3-a456-426614174000',
      action: 'approve',
    });
    expect(result.success).toBe(true);
  });

  it('should accept reject action with comment', () => {
    const result = approvalActionSchema.safeParse({
      entry_id: '123e4567-e89b-12d3-a456-426614174000',
      action: 'reject',
      comment: 'Insufficient documentation',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid action', () => {
    const result = approvalActionSchema.safeParse({
      entry_id: '123e4567-e89b-12d3-a456-426614174000',
      action: 'delete',
    });
    expect(result.success).toBe(false);
  });

  it('should reject comment over 500 chars', () => {
    const result = approvalActionSchema.safeParse({
      entry_id: '123e4567-e89b-12d3-a456-426614174000',
      action: 'reject',
      comment: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('programGoalSchema', () => {
  const validGoal = {
    resident_id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Complete 50 colonoscopies',
    target_count: 50,
    deadline: '2027-06-01',
  };

  it('should accept a valid goal', () => {
    const result = programGoalSchema.safeParse(validGoal);
    expect(result.success).toBe(true);
  });

  it('should reject target_count of 0', () => {
    const result = programGoalSchema.safeParse({
      ...validGoal,
      target_count: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject title exceeding 200 chars', () => {
    const result = programGoalSchema.safeParse({
      ...validGoal,
      title: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe('accreditationFrameworkSchema', () => {
  const validFramework = {
    name: 'ACGME Internal Medicine',
    tenant_id: '123e4567-e89b-12d3-a456-426614174000',
    framework_type: 'acgme',
    milestones: [
      {
        code: 'PC-1',
        description: 'Perform history and physical',
        competency_area: 'Patient Care',
        target_minimum: 10,
      },
    ],
  };

  it('should accept a valid framework', () => {
    const result = accreditationFrameworkSchema.safeParse(validFramework);
    expect(result.success).toBe(true);
  });

  it('should reject empty milestones array', () => {
    const result = accreditationFrameworkSchema.safeParse({
      ...validFramework,
      milestones: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing tenant_id', () => {
    const { tenant_id, ...rest } = validFramework;
    const result = accreditationFrameworkSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('should accept with default version', () => {
    const { version: _, ...rest } = validFramework;
    const result = accreditationFrameworkSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as typeof result.data & { version: string };
      expect(data.version).toBe('1.0');
    }
  });
});

describe('aiQuerySchema', () => {
  it('should accept a valid query', () => {
    const result = aiQuerySchema.safeParse({
      query: 'Analyze this case',
      resident_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant_id: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('should accept query with streaming', () => {
    const result = aiQuerySchema.safeParse({
      query: 'Analyze this case',
      resident_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant_id: '123e4567-e89b-12d3-a456-426614174000',
      stream: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stream).toBe(true);
    }
  });

  it('should reject empty query', () => {
    const result = aiQuerySchema.safeParse({
      query: '',
      resident_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant_id: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(false);
  });

  it('should reject query exceeding 2000 chars', () => {
    const result = aiQuerySchema.safeParse({
      query: 'x'.repeat(2001),
      resident_id: '123e4567-e89b-12d3-a456-426614174000',
      tenant_id: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(false);
  });
});

describe('residentAiToggleSchema', () => {
  it('should accept enabled toggle', () => {
    const result = residentAiToggleSchema.safeParse({ enabled: true });
    expect(result.success).toBe(true);
  });

  it('should accept toggle with quota', () => {
    const result = residentAiToggleSchema.safeParse({
      enabled: true,
      quota_limit: 50,
      quota_used: 10,
    });
    expect(result.success).toBe(true);
  });

  it('should default quota_used to 0', () => {
    const result = residentAiToggleSchema.safeParse({ enabled: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quota_used).toBe(0);
    }
  });

  it('should reject negative quota_used', () => {
    const result = residentAiToggleSchema.safeParse({
      enabled: true,
      quota_used: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe('accreditationMappingSchema', () => {
  it('should accept a valid mapping', () => {
    const result = accreditationMappingSchema.safeParse({
      framework_id: '123e4567-e89b-12d3-a456-426614174000',
      milestone_code: 'PC-1',
      competency_area: 'Patient Care',
    });
    expect(result.success).toBe(true);
  });

  it('should accept mapping with procedure role', () => {
    const result = accreditationMappingSchema.safeParse({
      framework_id: '123e4567-e89b-12d3-a456-426614174000',
      milestone_code: 'PC-1',
      competency_area: 'Patient Care',
      procedure_role: 'performed',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid procedure role', () => {
    const result = accreditationMappingSchema.safeParse({
      framework_id: '123e4567-e89b-12d3-a456-426614174000',
      milestone_code: 'PC-1',
      competency_area: 'Patient Care',
      procedure_role: 'watched',
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-UUID framework_id', () => {
    const result = accreditationMappingSchema.safeParse({
      framework_id: 'not-a-uuid',
      milestone_code: 'PC-1',
      competency_area: 'Patient Care',
    });
    expect(result.success).toBe(false);
  });
});
