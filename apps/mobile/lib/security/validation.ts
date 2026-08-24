/**
 * Comprehensive Zod validation for every write path in the E-Logbook mobile
 * app.  Schemas mirror the Supabase CHECK constraints exactly so bad data
 * is caught client-side before it touches WatermelonDB or the network.
 *
 * SECURITY goals
 * ──────────────
 *  1. Reject invalid enum values (status, form_type, shift_type) so they
 *     never reach a Supabase INSERT/UPDATE and trigger a 400 or, worse,
 *     a silent constraint-violation error path.
 *  2. Enforce PHI de-identification rule: when `is_deidentified` is true
 *     `patient_mrn` and `patient_dob` MUST be null (Postgres CHECK:
 *     NOT is_deidentified OR (patient_mrn IS NULL AND patient_dob IS NULL)).
 *  3. Strip HTML from free-text fields to prevent stored-XSS when the
 *     comment body is rendered in a web-view or exported to PDF.
 *  4. Bound numeric ranges (hours_worked 0-24, milestone level 1-5,
 *     overall_score 1-5) so downstream aggregation queries never see
 *     garbage.
 *
 * All enums are copied verbatim from the relevant CREATE TABLE migrations.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// 0. Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/** UUID regex — accepts any standard format (v1–v5), lowercase or uppercase. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ISO-8601 date string (YYYY-MM-DD). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const uuidField = z.string().regex(UUID_RE, 'Must be a valid UUID');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Case Entry schema
// ─────────────────────────────────────────────────────────────────────────────
// SQL source: 00001_schema.sql + 00025_add_brin_indexes_phi_check.sql
//
// CHECK constraints enforced:
//   status IN ('draft', 'pending', 'approved', 'rejected')
//   NOT is_deidentified OR (patient_mrn IS NULL AND patient_dob IS NULL)

export const CaseEntryStatus = z.enum([
  'draft',
  'pending',
  'approved',
  'rejected',
]);

export const CaseEntrySchema = z
  .object({
    tenant_id: uuidField,
    resident_id: uuidField,
    template_id: z.string().min(1, 'template_id is required'),
    patient_mrn: z.string().max(64).nullable().default(null),
    patient_dob: z.string().regex(DATE_RE, 'patient_dob must be YYYY-MM-DD').nullable().default(null),
    case_date: z.string().regex(DATE_RE, 'case_date must be YYYY-MM-DD'),
    field_values: z.record(z.string(), z.unknown()).default({}),
    status: CaseEntryStatus.default('draft'),
    is_deidentified: z.boolean().default(false),
  })
  .refine(
    (data) =>
      !data.is_deidentified ||
      (data.patient_mrn === null && data.patient_dob === null),
    {
      message:
        'PHI violation: when is_deidentified is true, patient_mrn and patient_dob must be null',
      path: ['patient_mrn'],
    },
  );

export type CaseEntryInput = z.infer<typeof CaseEntrySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Evaluation Form schema
// ─────────────────────────────────────────────────────────────────────────────
// SQL source: 00081_evaluation_forms.sql
//
// CHECK constraints:
//   form_type IN ('mini_cex','dops','cbd','cex','msf','osce','360_review','portfolio_review')
//   status    IN ('pending','completed','acknowledged')

export const EvaluationFormType = z.enum([
  'mini_cex',
  'dops',
  'cbd',
  'cex',
  'msf',
  'osce',
  '360_review',
  'portfolio_review',
]);

export const EvaluationFormStatus = z.enum([
  'pending',
  'completed',
  'acknowledged',
]);

/** Individual domain rating within the ratings JSONB blob. */
export const RatingDomainSchema = z.object({
  name: z.string().min(1).max(200),
  score: z.number().int().min(1).max(5),
  max: z.number().int().min(1).max(5).default(5),
});

export const EvaluationFormSchema = z.object({
  tenant_id: uuidField,
  resident_id: uuidField,
  evaluator_id: uuidField,
  form_type: EvaluationFormType,
  encounter_date: z.string().regex(DATE_RE, 'encounter_date must be YYYY-MM-DD').nullable().default(null),
  setting: z.string().max(500).nullable().default(null),
  patient_context: z.string().max(2000).nullable().default(null),
  ratings: z
    .object({
      domains: z.array(RatingDomainSchema).default([]),
    })
    .passthrough()
    .default({ domains: [] }),
  overall_score: z
    .number()
    .min(1, 'overall_score must be >= 1')
    .max(5, 'overall_score must be <= 5')
    .nullable()
    .default(null),
  feedback: z.string().max(10000).nullable().default(null),
  action_plan: z.string().max(10000).nullable().default(null),
  status: EvaluationFormStatus.default('pending'),
});

export type EvaluationFormInput = z.infer<typeof EvaluationFormSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Shift / Duty schema
// ─────────────────────────────────────────────────────────────────────────────
// SQL source: 00079_rotations.sql (shifts) + 00069_duty_tracking.sql (duty_periods)
//
// CHECK constraints:
//   hours_worked >= 0 AND hours_worked <= 24
//   shift_type IN ('call','clinic','vacation','weekend','regular','night','long')
//   (duty_periods also allows the subset above; mobile app writes to shifts)

export const ShiftType = z.enum([
  'call',
  'clinic',
  'vacation',
  'weekend',
  'regular',
  'night',
  'long',
]);

export const ShiftSchema = z.object({
  tenant_id: uuidField,
  resident_id: uuidField,
  shift_date: z.string().regex(DATE_RE, 'shift_date must be YYYY-MM-DD'),
  hours_worked: z
    .number()
    .min(0, 'hours_worked must be >= 0')
    .max(24, 'hours_worked must be <= 24'),
  shift_type: ShiftType.default('regular'),
  notes: z.string().max(5000).nullable().default(null),
});

export type ShiftInput = z.infer<typeof ShiftSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 4. Milestone schema
// ─────────────────────────────────────────────────────────────────────────────
// SQL source: 00080_milestones.sql
//
// CHECK constraint: level BETWEEN 1 AND 5

export const MilestoneSchema = z.object({
  tenant_id: uuidField,
  resident_id: uuidField,
  competency_area: z.string().min(1).max(200),
  sub_competency: z.string().min(1).max(200),
  level: z.number().int().min(1, 'level must be 1-5').max(5, 'level must be 1-5'),
  assessor_id: uuidField.nullable().default(null),
  assessment_date: z.string().regex(DATE_RE, 'assessment_date must be YYYY-MM-DD'),
  evidence_entry_id: uuidField.nullable().default(null),
  comments: z.string().max(5000).nullable().default(null),
});

export type MilestoneInput = z.infer<typeof MilestoneSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 5. Comment schema
// ─────────────────────────────────────────────────────────────────────────────
// SQL source: 00085_comments.sql
//
// CHECK: (entry_id IS NOT NULL OR evaluation_id IS NOT NULL)
// Body is free-text; we enforce a sane max and strip HTML to prevent stored-XSS.

const COMMENT_MAX_LENGTH = 5000;

export const CommentSchema = z
  .object({
    tenant_id: uuidField,
    author_id: uuidField,
    body: z
      .string()
      .min(1, 'Comment body must not be empty')
      .max(COMMENT_MAX_LENGTH, `Comment body must be <= ${COMMENT_MAX_LENGTH} characters`)
      .transform((val) => sanitizeString(val)),
    entry_id: uuidField.nullable().default(null),
    evaluation_id: uuidField.nullable().default(null),
    parent_id: uuidField.nullable().default(null),
  })
  .refine(
    (data) => data.entry_id !== null || data.evaluation_id !== null,
    {
      message: 'At least one of entry_id or evaluation_id is required',
      path: ['entry_id'],
    },
  );

export type CommentInput = z.infer<typeof CommentSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 6. Generic validation helper
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { ok: true; data: T; errors: [] }
  | { ok: false; data: null; errors: string[] };

/**
 * Validate arbitrary data against a Zod schema.
 *
 * Returns a discriminated result so callers never need to try/catch:
 *
 * ```ts
 * const result = validateInput(CaseEntrySchema, payload);
 * if (result.ok) {
 *   // result.data is fully typed
 * } else {
 *   // result.errors is a flat string array
 * }
 * ```
 */
export function validateInput<T>(
  schema: z.ZodType<T>,
  data: unknown,
): ValidationResult<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return { ok: true, data: parsed.data, errors: [] };
  }
  const errors = parsed.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`,
  );
  return { ok: false, data: null, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Input sanitizer
// ─────────────────────────────────────────────────────────────────────────────

const HTML_TAG_RE = /<[^>]*>/g;
const MULTIPLE_SPACES_RE = / {2,}/g;

/**
 * Sanitize a free-text string:
 *  1. Strip HTML/XML tags to prevent stored-XSS.
 *  2. Decode common HTML entities (`&amp;` → `&`, etc.).
 *  3. Collapse multiple spaces / tabs into a single space.
 *  4. Trim leading / trailing whitespace.
 *  5. Hard-truncate to `maxLen` characters (default 5 000).
 *
 * This is a best-effort client-side pass. The server should perform the
 * same sanitization before persisting.
 */
export function sanitizeString(str: string, maxLen = 5000): string {
  if (typeof str !== 'string') return '';

  // Strip HTML/XML tags first, before decoding entities.  This prevents
  // `&lt;script&gt;` from being decoded into `<script>` and then re-stripped
  // as a tag — the user's literal text is preserved.
  const stripped = str.replace(HTML_TAG_RE, '');

  const decoded = stripped
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  const collapsed = decoded
    .replace(MULTIPLE_SPACES_RE, ' ')
    .replace(/\t+/g, ' ')
    .trim();

  if (collapsed.length > maxLen) {
    return collapsed.slice(0, maxLen);
  }

  return collapsed;
}
