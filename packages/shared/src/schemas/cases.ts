import { z } from 'zod';

export const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'number', 'date', 'checkbox']),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
});

export const caseTemplateSchema = z.object({
  specialty: z.string().min(1),
  name: z.string().min(1),
  fields: z.array(templateFieldSchema).min(1),
  required_fields: z.array(z.string()),
});

export const accreditationMappingSchema = z.object({
  framework_id: z.string().uuid(),
  milestone_code: z.string().min(1),
  competency_area: z.string().min(1),
  procedure_role: z.enum(['observed', 'assisted', 'performed', 'supervised']).optional(),
});

export const caseEntryDeidentifiedSchema = z.object({
  template_id: z.string().uuid(),
  patient_age_years: z.number().int().min(0).max(150),
  patient_hash: z.string().max(128),
  case_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field_values: z.record(z.string(), z.unknown()),
  accreditation_mappings: z.array(accreditationMappingSchema).default([]),
  is_deidentified: z.literal(true),
});

export const caseEntryIdentifiedSchema = z.object({
  template_id: z.string().uuid(),
  patient_mrn: z.string().min(1).max(50),
  patient_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
  version: z.string().default('1.0'),
  framework_type: z.enum(['acgme', 'scfhs', 'gmc', 'canmeds', 'custom']),
  milestones: z.array(accreditationMilestoneSchema).min(1),
});

export const aiQuerySchema = z.object({
  query: z.string().min(1).max(500),
  resident_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  stream: z.boolean().default(false),
});
