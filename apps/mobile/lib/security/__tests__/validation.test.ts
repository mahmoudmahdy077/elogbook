import { describe, it, expect } from 'vitest';
import {
  CaseEntrySchema,
  CaseEntryStatus,
  EvaluationFormSchema,
  EvaluationFormType,
  EvaluationFormStatus,
  ShiftSchema,
  ShiftType,
  MilestoneSchema,
  CommentSchema,
  validateInput,
  sanitizeString,
} from '../validation';

// ─── Helpers ────────────────────────────────────────────────────────────────

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const UUID3 = '6ba7b810-9dad-11d1-80b4-00c04fd430c9';

const VALID_CASE_ENTRY = {
  tenant_id: UUID,
  resident_id: UUID2,
  template_id: 'tmpl-1',
  patient_mrn: 'MRN-12345',
  patient_dob: '1990-06-15',
  case_date: '2026-08-01',
  field_values: { procedure: 'appendectomy', outcome: 'positive' },
  status: 'draft' as const,
  is_deidentified: false,
};

const VALID_EVAL_FORM = {
  tenant_id: UUID,
  resident_id: UUID2,
  evaluator_id: UUID3,
  form_type: 'mini_cex' as const,
  encounter_date: '2026-07-20',
  setting: 'Inpatient ward',
  patient_context: '65 y/o male',
  ratings: { domains: [{ name: 'Clinical', score: 4, max: 5 }] },
  overall_score: 4.0,
  feedback: 'Good performance',
  action_plan: null,
  status: 'pending' as const,
};

const VALID_SHIFT = {
  tenant_id: UUID,
  resident_id: UUID2,
  shift_date: '2026-08-10',
  hours_worked: 12,
  shift_type: 'regular' as const,
  notes: null,
};

const VALID_MILESTONE = {
  tenant_id: UUID,
  resident_id: UUID2,
  competency_area: 'Patient Care',
  sub_competency: 'Compassionate care',
  level: 3,
  assessor_id: null,
  assessment_date: '2026-08-01',
  evidence_entry_id: null,
  comments: null,
};

const VALID_COMMENT = {
  tenant_id: UUID,
  author_id: UUID2,
  body: 'Solid case presentation.',
  entry_id: UUID3,
  evaluation_id: null,
  parent_id: null,
};

// ─── Case Entry ─────────────────────────────────────────────────────────────

describe('CaseEntrySchema', () => {
  it('accepts a fully valid case entry', () => {
    const result = CaseEntrySchema.safeParse(VALID_CASE_ENTRY);
    expect(result.success).toBe(true);
  });

  it('accepts minimal fields with defaults', () => {
    const result = CaseEntrySchema.safeParse({
      tenant_id: UUID,
      resident_id: UUID2,
      template_id: 't',
      case_date: '2026-08-01',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('draft');
      expect(result.data.is_deidentified).toBe(false);
      expect(result.data.field_values).toEqual({});
      expect(result.data.patient_mrn).toBeNull();
      expect(result.data.patient_dob).toBeNull();
    }
  });

  it('rejects invalid status', () => {
    const result = CaseEntrySchema.safeParse({
      ...VALID_CASE_ENTRY,
      status: 'bogus',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tenant_id (not UUID)', () => {
    const result = CaseEntrySchema.safeParse({
      ...VALID_CASE_ENTRY,
      tenant_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects case_date with wrong format', () => {
    const result = CaseEntrySchema.safeParse({
      ...VALID_CASE_ENTRY,
      case_date: '08/01/2026',
    });
    expect(result.success).toBe(false);
  });

  it('rejects patient_dob with wrong format', () => {
    const result = CaseEntrySchema.safeParse({
      ...VALID_CASE_ENTRY,
      patient_dob: '01-06-1990',
    });
    expect(result.success).toBe(false);
  });

  it('enforces PHI rule: is_deidentified with non-null patient_mrn', () => {
    const result = CaseEntrySchema.safeParse({
      ...VALID_CASE_ENTRY,
      is_deidentified: true,
      patient_mrn: 'LEAKED-MRN',
      patient_dob: null,
    });
    expect(result.success).toBe(false);
  });

  it('enforces PHI rule: is_deidentified with non-null patient_dob', () => {
    const result = CaseEntrySchema.safeParse({
      ...VALID_CASE_ENTRY,
      is_deidentified: true,
      patient_mrn: null,
      patient_dob: '1990-06-15',
    });
    expect(result.success).toBe(false);
  });

  it('allows is_deidentified when both PHI fields are null', () => {
    const result = CaseEntrySchema.safeParse({
      ...VALID_CASE_ENTRY,
      is_deidentified: true,
      patient_mrn: null,
      patient_dob: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('CaseEntryStatus enum', () => {
  it('only allows draft, pending, approved, rejected', () => {
    expect(CaseEntryStatus.options).toEqual([
      'draft',
      'pending',
      'approved',
      'rejected',
    ]);
  });
});

// ─── Evaluation Form ────────────────────────────────────────────────────────

describe('EvaluationFormSchema', () => {
  it('accepts a fully valid evaluation form', () => {
    const result = EvaluationFormSchema.safeParse(VALID_EVAL_FORM);
    expect(result.success).toBe(true);
  });

  it('accepts minimal fields with defaults', () => {
    const result = EvaluationFormSchema.safeParse({
      tenant_id: UUID,
      resident_id: UUID2,
      evaluator_id: UUID3,
      form_type: 'dops',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('pending');
      expect(result.data.overall_score).toBeNull();
      expect(result.data.ratings).toEqual({ domains: [] });
    }
  });

  it('rejects invalid form_type', () => {
    const result = EvaluationFormSchema.safeParse({
      ...VALID_EVAL_FORM,
      form_type: 'invalid_form',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = EvaluationFormSchema.safeParse({
      ...VALID_EVAL_FORM,
      status: 'archived',
    });
    expect(result.success).toBe(false);
  });

  it('rejects overall_score below 1', () => {
    const result = EvaluationFormSchema.safeParse({
      ...VALID_EVAL_FORM,
      overall_score: 0.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects overall_score above 5', () => {
    const result = EvaluationFormSchema.safeParse({
      ...VALID_EVAL_FORM,
      overall_score: 5.1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts overall_score at boundary 1', () => {
    const result = EvaluationFormSchema.safeParse({
      ...VALID_EVAL_FORM,
      overall_score: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts overall_score at boundary 5', () => {
    const result = EvaluationFormSchema.safeParse({
      ...VALID_EVAL_FORM,
      overall_score: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects rating domain score outside 1-5', () => {
    const result = EvaluationFormSchema.safeParse({
      ...VALID_EVAL_FORM,
      ratings: { domains: [{ name: 'Clinical', score: 6, max: 5 }] },
    });
    expect(result.success).toBe(false);
  });
});

describe('EvaluationFormType enum', () => {
  it('matches all 8 Supabase CHECK values', () => {
    expect(EvaluationFormType.options).toEqual([
      'mini_cex',
      'dops',
      'cbd',
      'cex',
      'msf',
      'osce',
      '360_review',
      'portfolio_review',
    ]);
  });
});

describe('EvaluationFormStatus enum', () => {
  it('matches Supabase CHECK values', () => {
    expect(EvaluationFormStatus.options).toEqual([
      'pending',
      'completed',
      'acknowledged',
    ]);
  });
});

// ─── Shift ──────────────────────────────────────────────────────────────────

describe('ShiftSchema', () => {
  it('accepts a valid shift', () => {
    const result = ShiftSchema.safeParse(VALID_SHIFT);
    expect(result.success).toBe(true);
  });

  it('accepts minimal fields with defaults', () => {
    const result = ShiftSchema.safeParse({
      tenant_id: UUID,
      resident_id: UUID2,
      shift_date: '2026-08-10',
      hours_worked: 8,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shift_type).toBe('regular');
      expect(result.data.notes).toBeNull();
    }
  });

  it('rejects hours_worked below 0', () => {
    const result = ShiftSchema.safeParse({
      ...VALID_SHIFT,
      hours_worked: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects hours_worked above 24', () => {
    const result = ShiftSchema.safeParse({
      ...VALID_SHIFT,
      hours_worked: 25,
    });
    expect(result.success).toBe(false);
  });

  it('accepts hours_worked at boundary 0', () => {
    const result = ShiftSchema.safeParse({
      ...VALID_SHIFT,
      hours_worked: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts hours_worked at boundary 24', () => {
    const result = ShiftSchema.safeParse({
      ...VALID_SHIFT,
      hours_worked: 24,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid shift_type', () => {
    const result = ShiftSchema.safeParse({
      ...VALID_SHIFT,
      shift_type: 'overnight',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID tenant_id', () => {
    const result = ShiftSchema.safeParse({
      ...VALID_SHIFT,
      tenant_id: 'abc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects bad date format', () => {
    const result = ShiftSchema.safeParse({
      ...VALID_SHIFT,
      shift_date: '10-08-2026',
    });
    expect(result.success).toBe(false);
  });
});

describe('ShiftType enum', () => {
  it('matches all 7 Supabase CHECK values', () => {
    expect(ShiftType.options).toEqual([
      'call',
      'clinic',
      'vacation',
      'weekend',
      'regular',
      'night',
      'long',
    ]);
  });
});

// ─── Milestone ──────────────────────────────────────────────────────────────

describe('MilestoneSchema', () => {
  it('accepts a valid milestone', () => {
    const result = MilestoneSchema.safeParse(VALID_MILESTONE);
    expect(result.success).toBe(true);
  });

  it('accepts level 1 (novice)', () => {
    const result = MilestoneSchema.safeParse({
      ...VALID_MILESTONE,
      level: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts level 5 (expert)', () => {
    const result = MilestoneSchema.safeParse({
      ...VALID_MILESTONE,
      level: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects level below 1', () => {
    const result = MilestoneSchema.safeParse({
      ...VALID_MILESTONE,
      level: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects level above 5', () => {
    const result = MilestoneSchema.safeParse({
      ...VALID_MILESTONE,
      level: 6,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer level (float)', () => {
    const result = MilestoneSchema.safeParse({
      ...VALID_MILESTONE,
      level: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty competency_area', () => {
    const result = MilestoneSchema.safeParse({
      ...VALID_MILESTONE,
      competency_area: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty sub_competency', () => {
    const result = MilestoneSchema.safeParse({
      ...VALID_MILESTONE,
      sub_competency: '',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Comment ────────────────────────────────────────────────────────────────

describe('CommentSchema', () => {
  it('accepts a valid comment with entry_id', () => {
    const result = CommentSchema.safeParse(VALID_COMMENT);
    expect(result.success).toBe(true);
  });

  it('accepts a comment with evaluation_id instead', () => {
    const result = CommentSchema.safeParse({
      ...VALID_COMMENT,
      entry_id: null,
      evaluation_id: UUID3,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a comment with both entry_id and evaluation_id', () => {
    const result = CommentSchema.safeParse({
      ...VALID_COMMENT,
      evaluation_id: UUID3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects comment with neither entry_id nor evaluation_id', () => {
    const result = CommentSchema.safeParse({
      ...VALID_COMMENT,
      entry_id: null,
      evaluation_id: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty body', () => {
    const result = CommentSchema.safeParse({
      ...VALID_COMMENT,
      body: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects body exceeding 5000 characters', () => {
    const result = CommentSchema.safeParse({
      ...VALID_COMMENT,
      body: 'x'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts body at exactly 5000 characters', () => {
    const result = CommentSchema.safeParse({
      ...VALID_COMMENT,
      body: 'x'.repeat(5000),
    });
    expect(result.success).toBe(true);
  });
});

// ─── validateInput helper ───────────────────────────────────────────────────

describe('validateInput', () => {
  it('returns ok:true with parsed data for valid input', () => {
    const result = validateInput(ShiftSchema, VALID_SHIFT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tenant_id).toBe(UUID);
      expect(result.errors).toEqual([]);
    }
  });

  it('returns ok:false with error strings for invalid input', () => {
    const result = validateInput(ShiftSchema, { tenant_id: 'bad' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(typeof result.errors[0]).toBe('string');
    }
  });

  it('includes field paths in error messages', () => {
    const result = validateInput(ShiftSchema, {
      ...VALID_SHIFT,
      hours_worked: -5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('hours_worked'))).toBe(true);
    }
  });
});

// ─── sanitizeString ─────────────────────────────────────────────────────────

describe('sanitizeString', () => {
  it('strips HTML tags', () => {
    expect(sanitizeString('<script>alert("xss")</script>Hello')).toBe(
      'alert("xss")Hello',
    );
  });

  it('strips nested HTML tags', () => {
    expect(sanitizeString('<div><b>Bold</b></div>')).toBe('Bold');
  });

  it('decodes HTML entities', () => {
    expect(sanitizeString('a &amp; b &lt; c &gt; d')).toBe('a & b < c > d');
  });

  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces', () => {
    expect(sanitizeString('hello   world')).toBe('hello world');
  });

  it('collapses tabs into spaces', () => {
    expect(sanitizeString('hello\t\tworld')).toBe('hello world');
  });

  it('truncates to max length', () => {
    const long = 'a'.repeat(6000);
    expect(sanitizeString(long).length).toBe(5000);
  });

  it('respects custom max length', () => {
    expect(sanitizeString('abcdef', 3)).toBe('abc');
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeString(null as unknown as string)).toBe('');
    expect(sanitizeString(undefined as unknown as string)).toBe('');
  });

  it('handles empty string', () => {
    expect(sanitizeString('')).toBe('');
  });

  it('handles string that is only HTML tags', () => {
    expect(sanitizeString('<br/><hr/>')).toBe('');
  });

  it('handles mixed content with HTML and entities', () => {
    expect(sanitizeString('<p>Hello &amp; <b>World</b></p>')).toBe(
      'Hello & World',
    );
  });

  it('strips self-closing tags', () => {
    expect(sanitizeString('Line1<br/>Line2<hr/>Line3')).toBe(
      'Line1Line2Line3',
    );
  });
});
