import { z } from 'zod';

export const fieldValidationSchema = z.object({
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  patternMessage: z.string().optional(),
}).refine(
  (v) => v.minLength === undefined || v.maxLength === undefined || v.minLength <= v.maxLength,
  { message: 'minLength must be <= maxLength' }
).refine(
  (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
  { message: 'min must be <= max' }
);

export const templateFieldSchema = z.object({
  key: z.string().min(1, 'Field key is required'),
  label: z.string().min(1, 'Field label is required'),
  type: z.enum(['text', 'textarea', 'select', 'number', 'date', 'checkbox']),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  defaultValue: z.unknown().optional(),
  order: z.number().int().min(0).optional(),
  validation: fieldValidationSchema.optional(),
}).refine(
  (field) => field.type !== 'select' || (field.options && field.options.length > 0),
  { message: 'Select fields must have at least one option' }
);

export const caseTemplateSchema = z.object({
  specialty: z.string().min(1),
  name: z.string().min(1),
  fields: z.array(templateFieldSchema).min(1),
  required_fields: z.array(z.string()),
}).refine(
  (data) => {
    const fieldKeys = new Set(data.fields.map(f => f.key));
    return data.required_fields.every(k => fieldKeys.has(k));
  },
  {
    message: 'All required_fields must exist in fields[].key',
    path: ['required_fields'],
  }
).refine(
  (data) => {
    const keys = data.fields.map(f => f.key);
    return keys.length === new Set(keys).size;
  },
  {
    message: 'Duplicate field keys are not allowed',
    path: ['fields'],
  }
);

export const accreditationMappingSchema = z.object({
  framework_id: z.string().uuid(),
  milestone_code: z.string().min(1),
  competency_area: z.string().min(1),
  procedure_role: z.enum(['observed', 'assisted', 'performed', 'supervised']).optional(),
});

export const caseEntryDeidentifiedSchema = z.object({
  template_id: z.string().uuid(),
  patient_age_years: z.number().int().min(0).max(150),
  patient_hash: z.string().max(128).nullable().optional(),
  case_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field_values: z.record(z.string(), z.unknown()),
  accreditation_mappings: z.array(accreditationMappingSchema).default([]),
  is_deidentified: z.literal(true),
});

export const caseEntryIdentifiedSchema = z.object({
  template_id: z.string().uuid(),
  patient_mrn: z.string().min(1).max(50).nullable(),
  patient_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  case_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field_values: z.record(z.string(), z.unknown()),
  accreditation_mappings: z.array(accreditationMappingSchema).default([]),
  is_deidentified: z.literal(false),
});

export const caseEntrySchema = z.discriminatedUnion('is_deidentified', [
  caseEntryDeidentifiedSchema,
  caseEntryIdentifiedSchema,
]);

export const approvalActionSchema = z.object({
  entry_id: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(500).optional(),
});

export const programGoalSchema = z.object({
  resident_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  target_count: z.number().int().min(1),
  specialty: z.string().nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(1000).nullable().optional(),
});

export const accreditationMilestoneSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  competency_area: z.string().min(1),
  target_minimum: z.number().int().min(1),
  specialty: z.string().optional(),
});

export const accreditationFrameworkSchema = z.object({
  name: z.string().min(1).max(200),
  tenant_id: z.string().uuid(),
  version: z.string().default('1.0'),
  framework_type: z.enum(['acgme', 'scfhs', 'gmc', 'canmeds', 'custom']),
  milestones: z.array(accreditationMilestoneSchema).min(1),
});

export const aiQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  resident_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  stream: z.boolean().default(false),
});

export const residentAiToggleSchema = z.object({
  enabled: z.boolean(),
  quota_limit: z.number().int().min(1).nullable().optional(),
  quota_used: z.number().int().min(0).default(0),
});
