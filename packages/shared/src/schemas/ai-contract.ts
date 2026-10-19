export const AI_FIELD_NAMES = [
  'age_group',
  'anesthesia',
  'anesthesia_type',
  'approach',
  'body_part',
  'body_region',
  'case_type',
  'clinical_details',
  'clinical_indication',
  'clinical_notes',
  'comparison_studies',
  'complexity',
  'comorbidity',
  'comorbidities',
  'complication',
  'complications',
  'contrast_used',
  'description',
  'diagnosis',
  'duration_minutes',
  'findings',
  'follow_up',
  'impression',
  'indication',
  'level',
  'location',
  'modality',
  'notes',
  'outcome',
  'procedure',
  'procedure_code',
  'procedure_name',
  'role',
  'setting',
  'specialty',
  'status',
  'summary',
  'supervised',
  'supervision_level',
  'technique',
  'teaching',
  'urgent',
  'urgency',
] as const;

export type AiFieldName = typeof AI_FIELD_NAMES[number];
export type AiFieldKind = 'category' | 'category_list' | 'integer' | 'boolean' | 'text_presence';

export const AI_FIELD_KINDS: Readonly<Record<AiFieldName, AiFieldKind>> = Object.freeze({
  age_group: 'category',
  anesthesia: 'category',
  anesthesia_type: 'category',
  approach: 'category',
  body_part: 'category',
  body_region: 'category',
  case_type: 'category',
  clinical_details: 'text_presence',
  clinical_indication: 'text_presence',
  clinical_notes: 'text_presence',
  comparison_studies: 'category_list',
  complexity: 'category',
  comorbidity: 'category',
  comorbidities: 'category_list',
  complication: 'category',
  complications: 'category_list',
  contrast_used: 'category',
  description: 'text_presence',
  diagnosis: 'text_presence',
  duration_minutes: 'integer',
  findings: 'text_presence',
  follow_up: 'text_presence',
  impression: 'text_presence',
  indication: 'text_presence',
  level: 'category',
  location: 'category',
  modality: 'category',
  notes: 'text_presence',
  outcome: 'category',
  procedure: 'category',
  procedure_code: 'integer',
  procedure_name: 'category',
  role: 'category',
  setting: 'category',
  specialty: 'category',
  status: 'category',
  summary: 'text_presence',
  supervised: 'boolean',
  supervision_level: 'category',
  technique: 'category',
  teaching: 'boolean',
  urgent: 'boolean',
  urgency: 'category',
});

export function normalizeAiFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const AI_NORMALIZED_FIELD_NAMES: readonly string[] = Object.freeze(
  AI_FIELD_NAMES.map(normalizeAiFieldKey),
);
export const AI_FIELD_ALLOWLIST = AI_FIELD_NAMES;
export const AI_NORMALIZED_FIELD_ALLOWLIST = AI_NORMALIZED_FIELD_NAMES;

const CANONICAL_FIELD_BY_NORMALIZED = new Map(
  AI_FIELD_NAMES.map((name) => [normalizeAiFieldKey(name), name] as const),
);

export function canonicalAiFieldName(value: string): AiFieldName | null {
  return CANONICAL_FIELD_BY_NORMALIZED.get(normalizeAiFieldKey(value)) ?? null;
}

export const AI_INPUT_TOKENS = [
  'auto-analysis',
  'quality-assessment',
  'gap-analysis',
  'insights-overview',
  'insights-trends',
  'insights-development',
] as const;

export const AI_INTENTS = [
  'overview',
  'trends',
  'development',
  'case-mix',
] as const;

export type AiInputToken = typeof AI_INPUT_TOKENS[number];
export type AiIntent = typeof AI_INTENTS[number];

export const AI_MAX_CATEGORY_LENGTH = 64;
export const AI_MAX_CATEGORY_ITEMS = 8;
export const AI_MAX_INTEGER = 100_000;
export const AI_MAX_DURATION_MINUTES = 1_440;
export const AI_MAX_TEXT_FIELD_WORDS = 50;
