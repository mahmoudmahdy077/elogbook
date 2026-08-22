/**
 * Domain enumerations shared across web and mobile.
 *
 * Single source of truth for values that mirror database CHECK
 * constraints. When you change a CHECK constraint in a migration,
 * update the matching constant here in the same commit — screens that
 * render pickers/chips MUST import from here instead of redeclaring
 * local arrays (drift between UI lists and DB constraints caused a
 * real runtime bug: 'procedure_log' offered in UI, rejected by DB).
 */

/** evaluation_forms.form_type — migration 00081_evaluation_forms.sql */
export const EVALUATION_FORM_TYPES = [
  { key: 'mini_cex', label: 'Mini-CEX' },
  { key: 'cex', label: 'CEX' },
  { key: 'dops', label: 'DOPS' },
  { key: 'cbd', label: 'Case-Based Discussion' },
  { key: 'msf', label: 'Multi-Source Feedback' },
  { key: 'osce', label: 'OSCE' },
  { key: '360_review', label: '360 Review' },
  { key: 'portfolio_review', label: 'Portfolio Review' },
] as const;

export type EvaluationFormType = (typeof EVALUATION_FORM_TYPES)[number]['key'];

/** duty_periods.shift_type — migration 00069_duty_tracking.sql */
export const DUTY_SHIFT_TYPES = [
  { key: 'call', label: 'Call' },
  { key: 'clinic', label: 'Clinic' },
  { key: 'vacation', label: 'Vacation' },
  { key: 'weekend', label: 'Weekend' },
  { key: 'regular', label: 'Regular' },
] as const;

export type DutyShiftType = (typeof DUTY_SHIFT_TYPES)[number]['key'];

/** Tenant-settings key for the resident daily case goal (tenants.settings JSONB). */
export const DAILY_CASE_GOAL_KEY = 'daily_case_goal';

/** Fallback when the tenant has not configured a daily case goal. */
export const DEFAULT_DAILY_CASE_GOAL = 10;
