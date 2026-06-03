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

export const caseEntrySchema = z.object({
  template_id: z.string().uuid(),
  patient_mrn: z.string().min(1).max(50),
  patient_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  case_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field_values: z.record(z.unknown()),
});

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
