type AiFieldKind = 'category' | 'category_list' | 'integer' | 'boolean' | 'text_presence';

const AI_FIELD_NAMES = [
  'age_group', 'anesthesia', 'anesthesia_type', 'approach', 'body_part', 'body_region',
  'case_type', 'clinical_details', 'clinical_indication', 'clinical_notes', 'comparison_studies',
  'complexity', 'comorbidity', 'comorbidities', 'complication', 'complications', 'contrast_used',
  'description', 'diagnosis', 'duration_minutes', 'findings', 'follow_up', 'impression', 'indication',
  'level', 'location', 'modality', 'notes', 'outcome', 'procedure', 'procedure_code', 'procedure_name',
  'role', 'setting', 'specialty', 'status', 'summary', 'supervised', 'supervision_level', 'technique',
  'teaching', 'urgent', 'urgency',
] as const;

type AiFieldName = typeof AI_FIELD_NAMES[number];

const AI_FIELD_KINDS: Readonly<Record<AiFieldName, AiFieldKind>> = Object.freeze({
  age_group: 'category', anesthesia: 'category', anesthesia_type: 'category', approach: 'category',
  body_part: 'category', body_region: 'category', case_type: 'category', clinical_details: 'text_presence',
  clinical_indication: 'text_presence', clinical_notes: 'text_presence', comparison_studies: 'category_list',
  complexity: 'category', comorbidity: 'category', comorbidities: 'category_list', complication: 'category',
  complications: 'category_list', contrast_used: 'category', description: 'text_presence', diagnosis: 'text_presence',
  duration_minutes: 'integer', findings: 'text_presence', follow_up: 'text_presence', impression: 'text_presence',
  indication: 'text_presence', level: 'category', location: 'category', modality: 'category', notes: 'text_presence',
  outcome: 'category', procedure: 'category', procedure_code: 'integer', procedure_name: 'category', role: 'category',
  setting: 'category', specialty: 'category', status: 'category', summary: 'text_presence', supervised: 'boolean',
  supervision_level: 'category', technique: 'category', teaching: 'boolean', urgent: 'boolean', urgency: 'category',
});

function normalizeAiFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const AI_NORMALIZED_FIELD_NAMES: readonly string[] = Object.freeze(AI_FIELD_NAMES.map(normalizeAiFieldKey));
const CANONICAL_FIELD_BY_NORMALIZED = new Map(AI_FIELD_NAMES.map((name) => [normalizeAiFieldKey(name), name] as const));
function canonicalAiFieldName(value: string): AiFieldName | null {
  return CANONICAL_FIELD_BY_NORMALIZED.get(normalizeAiFieldKey(value)) ?? null;
}

const AI_INPUT_TOKENS = [
  'auto-analysis', 'quality-assessment', 'gap-analysis', 'insights-overview', 'insights-trends', 'insights-development',
] as const;
const AI_MAX_CATEGORY_LENGTH = 64;
const AI_MAX_CATEGORY_ITEMS = 8;
const AI_MAX_INTEGER = 100_000;
const AI_MAX_DURATION_MINUTES = 1_440;
const AI_MAX_TEXT_FIELD_WORDS = 50;

export type AiAal = 'aal1' | 'aal2';
export type AiOutputKind = 'text' | 'quality' | 'gap';

export interface AiBudget {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCostCents: number;
  maxFanOut: number;
}

export const DEFAULT_AI_BUDGET: Readonly<AiBudget> = Object.freeze({
  maxInputBytes: 32_768,
  maxOutputBytes: 32_768,
  maxInputTokens: 8_192,
  maxOutputTokens: 4_096,
  maxCostCents: 100,
  maxFanOut: 4,
});

export interface AiPrincipal {
  actorId: string;
  tenantId: string;
  role: string;
  status?: string;
  aal?: AiAal | null;
}

export interface AiAuthorizationContext {
  principal: AiPrincipal;
  allowedActions?: readonly string[];
  requireAal2?: boolean;
  requireDeidentified?: boolean;
}

export type AiGuardFailure =
  | 'invalid_request'
  | 'invalid_context'
  | 'tenant_mismatch'
  | 'actor_mismatch'
  | 'account_inactive'
  | 'aal2_required'
  | 'action_forbidden'
  | 'deidentification_required'
  | 'invalid_output'
  | 'unsafe_content'
  | 'budget_exceeded';

export type AiGuardResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AiGuardFailure; message: string };

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costCents?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_cents?: number;
}

const EXECUTABLE_CONTENT = /(?:<\s*\/?\s*(?:script|iframe|object|embed|style|svg|img)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|(?:^|[\s`])(?:rm\s+-rf|curl\s+|wget\s+|powershell(?:\.exe)?\s+|bash\s+-c|sh\s+-c)\b|\b(?:drop|truncate|alter)\s+table\b|\bunion\s+select\b)/i;
const ALLOWED_ACTIONS = new Set(['ai:insights', 'ai:quality', 'ai:gap-analysis', 'ai:completion']);
const PRIVILEGED_ACTIONS = new Set(['ai:quality', 'ai:gap-analysis', 'ai:completion']);
const ROLE_ACTIONS: Record<string, ReadonlySet<string>> = {
  resident: new Set(['ai:insights']),
  supervisor: new Set(['ai:insights', 'ai:quality', 'ai:gap-analysis']),
  director: new Set(['ai:insights', 'ai:quality', 'ai:gap-analysis', 'ai:completion']),
  institution_admin: new Set(['ai:insights', 'ai:quality', 'ai:gap-analysis']),
  admin: new Set(['ai:insights', 'ai:quality', 'ai:gap-analysis']),
};

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasControlContent(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isSafeText(value: string): boolean {
  return !hasControlContent(value) && !EXECUTABLE_CONTENT.test(value);
}

function failure<T>(reason: AiGuardFailure, message: string): AiGuardResult<T> {
  return { ok: false, reason, message };
}

const DEIDENTIFIED_FIELD_ALLOWLIST = new Set(AI_NORMALIZED_FIELD_NAMES);
export const AI_FIELD_ALLOWLIST = AI_FIELD_NAMES;
export const AI_NORMALIZED_FIELD_ALLOWLIST = AI_NORMALIZED_FIELD_NAMES;
const AI_INPUT_TOKEN_SET = new Set<string>(AI_INPUT_TOKENS);
const PHI_KEY_PARTS = [
  'address',
  'contact',
  'dob',
  'email',
  'identity',
  'mrn',
  'name',
  'phone',
  'resident',
  'patient',
  'ssn',
];

const CLINICAL_NAME_EXCLUSIONS = /\b(?:laparoscopic|appendectomy|surgery|medical|clinical|patient|resident|case|general|internal|medicine|emergency|cardiology|orthopedic|pediatric|neurology|recovery|hospital|clinic|institution|department|program|template|logbook|quality|assessment|service|system|follow[- ]?up|outpatient|inpatient|diagnos\w*|procedure|treatment|therapy|anesthesia|complication|my|new|the|this|age|group|adult|child|infant|neonate|older)\b/i;

function containsLikelyPersonName(value: string): boolean {
  if (/\b(?:Dr|Mr|Mrs|Ms|Miss)\.?\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)+\b/i.test(value)) return true;
  if (/\b[A-Z][A-Za-z'-]+,\s*[A-Z][A-Za-z'-]+\b/i.test(value)) return true;
  const matches = value.match(/\b[A-Z][a-z]{1,30}\s+[A-Z][a-z]{1,30}\b/g);
  return Boolean(matches?.some((match) => !CLINICAL_NAME_EXCLUSIONS.test(match)));
}

const PHI_VALUE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['email', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ['phone', /(?:\+?\d[\d(). -]{7,}\d)/],
  ['address', /\b\d{1,5}\s+[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,4}\s+(?:STREET|ST|ROAD|RD|AVENUE|AVE|BOULEVARD|BLVD|LANE|LN|DRIVE|DR|COURT|CT|WAY|TERRACE|PLACE|PL)\b/i],
  ['address', /\bP\.?\s*O\.?\s+BOX\s+\d+\b/i],
  ['dob', /\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/],
  ['ssn', /\b\d{3}[- ]\d{2}[- ]\d{4}\b/],
  ['mrn', /\b(?:MRN|MEDICAL\s+RECORD(?:\s+NUMBER)?|PATIENT\s+RECORD)\s*[:#=-]?\s*[A-Z0-9][A-Z0-9-]{3,}\b/i],
  ['mrn', /\b\d{6,}\b/],
  ['name', /\b(?:DR|MR|MRS|MS|MISS)\.?\s+[A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]+)+\b/],
  ['name', /\b(?:PATIENT|RESIDENT)\s+[A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]+)+\b/],
];

function normalizedKey(value: string): string {
  return normalizeAiFieldKey(value);
}

function hasPhiKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (DEIDENTIFIED_FIELD_ALLOWLIST.has(normalized)) return false;
  return PHI_KEY_PARTS.some((part) => normalized.includes(part));
}

function addFinding(findings: Set<string>, finding: string): void {
  findings.add(finding);
}

function scanPhiValue(value: unknown, findings: Set<string>, key = '', depth = 0, seen = new WeakSet<object>()): void {
  if (depth > 8) {
    addFinding(findings, 'depth');
    return;
  }
  if (value === null || value === undefined || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      addFinding(findings, 'invalid_number');
      return;
    }
    scanPhiValue(String(value), findings, key, depth + 1, seen);
    return;
  }
  if (typeof value === 'string') {
    if (hasPhiKey(key)) addFinding(findings, 'field-name');
    for (const [finding, pattern] of PHI_VALUE_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(value)) addFinding(findings, finding);
    }
    if (containsLikelyPersonName(value)) addFinding(findings, 'name');
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) {
    addFinding(findings, 'circular');
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) scanPhiValue(item, findings, key, depth + 1, seen);
  } else {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (hasPhiKey(childKey)) addFinding(findings, 'field-name');
      scanPhiValue(childValue, findings, childKey, depth + 1, seen);
    }
  }
  seen.delete(value);
}

export function findPhi(value: unknown): string[] {
  const findings = new Set<string>();
  scanPhiValue(value, findings);
  return [...findings];
}

export function containsPhi(value: unknown): boolean {
  return findPhi(value).length > 0;
}

type FieldValueResult = { ok: true; value: unknown } | { ok: false; message: string };

const CATEGORY_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _./+()'-]{0,63}$/;

function validateCategoryValue(value: unknown): FieldValueResult {
  if (typeof value !== 'string') return { ok: false, message: 'categorical value must be a string' };
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > AI_MAX_CATEGORY_LENGTH || !CATEGORY_VALUE_PATTERN.test(normalized)) {
    return { ok: false, message: 'categorical value is not bounded' };
  }
  if (findPhi(normalized).length > 0) return { ok: false, message: 'identifying value detected' };
  return { ok: true, value: normalized };
}

function validateFieldValue(
  field: AiFieldName,
  kind: AiFieldKind,
  value: unknown,
  transformFreeText: boolean,
): FieldValueResult {
  if (kind === 'text_presence') {
    if (transformFreeText) {
      if (typeof value === 'boolean') return { ok: true, value };
      if (typeof value === 'string') {
        if (value.length > 2_000 || value.trim().split(/\s+/).filter(Boolean).length > AI_MAX_TEXT_FIELD_WORDS) {
          return { ok: false, message: `free-text field exceeds its bounded representation: ${field}` };
        }
        if (findPhi(value).length > 0) return { ok: false, message: 'identifying value detected' };
        return { ok: true, value: value.trim().length > 0 };
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item !== 'string' || item.length > 2_000 || item.trim().split(/\s+/).filter(Boolean).length > AI_MAX_TEXT_FIELD_WORDS || findPhi(item).length > 0) {
            return { ok: false, message: `free-text field contains an unsupported value: ${field}` };
          }
        }
        return { ok: true, value: value.length > 0 };
      }
      return { ok: false, message: `free-text field must be a bounded representation: ${field}` };
    }
    if (typeof value !== 'boolean') return { ok: false, message: `free-text field must be transformed: ${field}` };
    return { ok: true, value };
  }
  if (kind === 'boolean') {
    return typeof value === 'boolean'
      ? { ok: true, value }
      : { ok: false, message: `boolean field is invalid: ${field}` };
  }
  if (kind === 'integer') {
    const maximum = field === 'duration_minutes' ? AI_MAX_DURATION_MINUTES : AI_MAX_INTEGER;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maximum) {
      return { ok: false, message: `integer field is invalid: ${field}` };
    }
    if (findPhi(String(value)).length > 0) return { ok: false, message: 'identifying value detected' };
    return { ok: true, value };
  }
  if (kind === 'category') return validateCategoryValue(value);
  if (!Array.isArray(value) || value.length === 0 || value.length > AI_MAX_CATEGORY_ITEMS) {
    return { ok: false, message: `category list is invalid: ${field}` };
  }
  const categories: string[] = [];
  for (const item of value) {
    const result = validateCategoryValue(item);
    if (!result.ok) return result;
    categories.push(result.value as string);
  }
  return { ok: true, value: categories };
}

function normalizeStructuredFields(
  value: unknown,
  transformFreeText: boolean,
  depth = 0,
  seen = new WeakSet<object>(),
): FieldValueResult {
  if (depth > 4) return { ok: false, message: 'maximum nesting depth exceeded' };
  if (!isObject(value)) return { ok: false, message: 'structured AI input must be an object' };
  if (seen.has(value)) return { ok: false, message: 'circular field value' };
  seen.add(value);
  const output: Record<string, unknown> = {};
  try {
    for (const [key, child] of Object.entries(value)) {
      const field = canonicalAiFieldName(key);
      if (!field || !DEIDENTIFIED_FIELD_ALLOWLIST.has(normalizedKey(field))) {
        return { ok: false, message: `field is not allowlisted: ${key}` };
      }
      const result = validateFieldValue(field, AI_FIELD_KINDS[field], child, transformFreeText);
      if (!result.ok) return result;
      output[field] = result.value;
    }
    return { ok: true, value: output };
  } finally {
    seen.delete(value);
  }
}

export function transformDeidentifiedFieldValues(
  value: unknown,
  budgetValue: Partial<AiBudget> = {},
): AiGuardResult<Record<string, unknown>> {
  const budget = readBudget(budgetValue);
  if (!budget) return failure('budget_exceeded', 'requested budget exceeds the hard limit');
  const normalized = value === null || value === undefined ? {} : value;
  const result = normalizeStructuredFields(normalized, true);
  if (!result.ok) return failure('unsafe_content', result.message);
  const output = result.value as Record<string, unknown>;
  if (bytes(JSON.stringify(output)) > budget.maxInputBytes) return failure('budget_exceeded', 'structured AI input exceeds the input budget');
  return { ok: true, value: output };
}

export function validateDeidentifiedFieldValues(
  value: unknown,
  budgetValue: Partial<AiBudget> = {},
): AiGuardResult<Record<string, unknown>> {
  const budget = readBudget(budgetValue);
  if (!budget) return failure('budget_exceeded', 'requested budget exceeds the hard limit');
  const normalized = value === null || value === undefined ? {} : value;
  const result = normalizeStructuredFields(normalized, false);
  if (!result.ok) return failure('unsafe_content', result.message);
  const output = result.value as Record<string, unknown>;
  if (bytes(JSON.stringify(output)) > budget.maxInputBytes) return failure('budget_exceeded', 'structured AI input exceeds the input budget');
  return { ok: true, value: output };
}

export function validateStructuredFieldNames(
  value: unknown,
): AiGuardResult<Record<string, true>> {
  const names = Array.isArray(value) ? value : [];
  const output: Record<string, true> = {};
  for (const name of names) {
    if (typeof name !== 'string') return failure('unsafe_content', 'structured field name is invalid');
    const field = canonicalAiFieldName(name);
    if (!field) return failure('unsafe_content', `field is not allowlisted: ${name}`);
    output[field] = true;
  }
  return { ok: true, value: output };
}

function isBoundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= maximum;
}

function readBudget(value?: Partial<AiBudget>): AiBudget | null {
  if (!value) return { ...DEFAULT_AI_BUDGET };
  for (const [key, maximum] of Object.entries(DEFAULT_AI_BUDGET)) {
    const candidate = value[key as keyof AiBudget];
    if (candidate !== undefined && !isBoundedInteger(candidate, maximum)) return null;
  }
  return { ...DEFAULT_AI_BUDGET, ...value } as AiBudget;
}

function principalFrom(value: AiPrincipal | AiAuthorizationContext): AiPrincipal | null {
  if (!isObject(value)) return null;
  if ('principal' in value && isObject(value.principal)) return value.principal as unknown as AiPrincipal;
  const candidate = value as unknown as AiPrincipal;
  if (!isNonEmptyString(candidate.actorId) || !isNonEmptyString(candidate.tenantId) || !isNonEmptyString(candidate.role)) return null;
  return candidate;
}

export function hasUnsafeAiContent(value: string): boolean {
  return !isSafeText(value);
}

function usageNumber(usage: AiUsage, camel: keyof AiUsage, snake: keyof AiUsage): number | undefined {
  const value = usage[camel] ?? usage[snake];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function validateUsage(usage: unknown, budget: AiBudget): AiGuardResult<AiUsage> {
  if (!isObject(usage)) return failure('invalid_output', 'usage must be an object');
  const source = usage as AiUsage;
  const supplied = [
    ['inputTokens', source.inputTokens ?? source.input_tokens],
    ['outputTokens', source.outputTokens ?? source.output_tokens],
    ['totalTokens', source.totalTokens ?? source.total_tokens],
    ['costCents', source.costCents ?? source.cost_cents],
  ] as const;
  if (supplied.some(([, value]) => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)))) return failure('invalid_output', 'usage values must be non-negative integers');
  const result: AiUsage = {
    inputTokens: usageNumber(source, 'inputTokens', 'input_tokens'),
    outputTokens: usageNumber(source, 'outputTokens', 'output_tokens'),
    totalTokens: usageNumber(source, 'totalTokens', 'total_tokens'),
    costCents: usageNumber(source, 'costCents', 'cost_cents'),
  };
  if ((result.inputTokens ?? 0) > budget.maxInputTokens || (result.outputTokens ?? 0) > budget.maxOutputTokens || (result.totalTokens ?? 0) > budget.maxInputTokens + budget.maxOutputTokens || (result.costCents ?? 0) > budget.maxCostCents) {
    return failure('budget_exceeded', 'model usage exceeds the request budget');
  }
  if (result.inputTokens !== undefined && result.outputTokens !== undefined && result.totalTokens !== undefined && result.totalTokens !== result.inputTokens + result.outputTokens) {
    return failure('invalid_output', 'usage total does not equal input and output tokens');
  }
  return { ok: true, value: result };
}

export function enforceAiBudget(
  usage: AiUsage,
  budgetValue: Partial<AiBudget> = {},
): AiGuardResult<AiUsage> {
  const budget = readBudget(budgetValue);
  if (!budget) return failure('budget_exceeded', 'requested budget exceeds the hard limit');
  return validateUsage(usage, budget);
}

function validateTextOutput(value: unknown, budget: AiBudget): AiGuardResult<{ content: string; usage?: AiUsage }> {
  if (typeof value !== 'string') return failure('invalid_output', 'model output must be text');
  if (!isSafeText(value)) return failure('unsafe_content', 'model output contains executable or control content');
  if (containsPhi(value)) return failure('unsafe_content', 'model output contains potentially identifying information');
  if (bytes(value) > budget.maxOutputBytes) return failure('budget_exceeded', 'model output exceeds the byte budget');
  if (Math.ceil(value.length / 4) > budget.maxOutputTokens) return failure('budget_exceeded', 'model output exceeds the token budget');
  return { ok: true, value: { content: value } };
}

function validateQualityOutput(value: unknown, budget: AiBudget): AiGuardResult<Record<string, unknown>> {
  if (!isObject(value)) return failure('invalid_output', 'quality output must be an object');
  const allowed = new Set(['scores', 'suggestions', 'analyzed_fields', 'missing_fields']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return failure('invalid_output', 'quality output contains unknown fields');
  if (!isObject(value.scores)) return failure('invalid_output', 'quality scores are required');
  const scoreKeys = ['completeness', 'specificity', 'classification', 'overall'];
  if (Object.keys(value.scores).some((key) => !scoreKeys.includes(key))) return failure('invalid_output', 'quality scores contain unknown fields');
  for (const key of scoreKeys) {
    const score = value.scores[key];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return failure('invalid_output', 'quality scores must be between 0 and 100');
  }
  if (!Array.isArray(value.suggestions) || value.suggestions.length > 8 || value.suggestions.some((item) => typeof item !== 'string' || !isSafeText(item) || bytes(item) > 500)) return failure('invalid_output', 'quality suggestions are invalid');
  const analyzedFields = value.analyzed_fields;
  if (analyzedFields !== undefined && (typeof analyzedFields !== 'number' || !Number.isInteger(analyzedFields) || analyzedFields < 0 || analyzedFields > 10_000)) return failure('invalid_output', 'analyzed_fields is invalid');
  if (value.missing_fields !== undefined && (!Array.isArray(value.missing_fields) || value.missing_fields.length > 200 || value.missing_fields.some((item) => typeof item !== 'string' || !isSafeText(item) || bytes(item) > 200))) return failure('invalid_output', 'missing_fields is invalid');
  if (findPhi(value).length > 0) return failure('unsafe_content', 'quality output contains potentially identifying information');
  if (bytes(JSON.stringify(value)) > budget.maxOutputBytes) return failure('budget_exceeded', 'quality output exceeds the byte budget');
  return { ok: true, value };
}

function validateGapOutput(value: unknown, budget: AiBudget): AiGuardResult<Record<string, unknown>> {
  if (!isObject(value)) return failure('invalid_output', 'gap output must be an object');
  const allowed = new Set(['gaps', 'summary']);
  if (Object.keys(value).some((key) => !allowed.has(key)) || !Array.isArray(value.gaps) || value.gaps.length > 20 || typeof value.summary !== 'string' || !isSafeText(value.summary)) return failure('invalid_output', 'gap output is invalid');
  for (const gap of value.gaps) {
    if (!isObject(gap) || Object.keys(gap).some((key) => !['competency', 'current', 'target', 'gap', 'recommendation'].includes(key))) return failure('invalid_output', 'gap entry is invalid');
    if (typeof gap.competency !== 'string' || !isSafeText(gap.competency) || typeof gap.recommendation !== 'string' || !isSafeText(gap.recommendation)) return failure('invalid_output', 'gap entry text is invalid');
    for (const key of ['current', 'target', 'gap']) {
      if (typeof gap[key] !== 'number' || !Number.isFinite(gap[key]) || gap[key] < 0) return failure('invalid_output', 'gap entry numbers are invalid');
    }
  }
  if (findPhi(value).length > 0) return failure('unsafe_content', 'gap output contains potentially identifying information');
  if (bytes(JSON.stringify(value)) > budget.maxOutputBytes) return failure('budget_exceeded', 'gap output exceeds the byte budget');
  return { ok: true, value };
}

function parseStructured(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function validateStructuredOutput(
  value: unknown,
  kind: Exclude<AiOutputKind, 'text'>,
  budgetValue: Partial<AiBudget> = {},
): AiGuardResult<Record<string, unknown>> {
  const budget = readBudget(budgetValue);
  if (!budget) return failure('budget_exceeded', 'requested budget exceeds the hard limit');
  const parsed = parseStructured(value);
  if (kind === 'quality') return validateQualityOutput(parsed, budget);
  return validateGapOutput(parsed, budget);
}

export function validateModelOutput(
  value: unknown,
  budgetValue: Partial<AiBudget> = {},
  usage?: AiUsage,
): AiGuardResult<{ content: string; usage?: AiUsage }> {
  const budget = readBudget(budgetValue);
  if (!budget) return failure('budget_exceeded', 'requested budget exceeds the hard limit');
  if (usage) {
    const usageResult = validateUsage(usage, budget);
    if (!usageResult.ok) return usageResult;
  }
  if (isObject(value)) {
    const allowed = new Set(['content', 'usage', 'tool_calls']);
    if (Object.keys(value).some((key) => !allowed.has(key))) return failure('invalid_output', 'model output contains unknown fields');
    if (value.tool_calls !== undefined && (!Array.isArray(value.tool_calls) || value.tool_calls.length > 0)) return failure('invalid_output', 'model tool calls are not executable');
    const content = validateTextOutput(value.content, budget);
    if (!content.ok) return content;
    const embeddedUsage = value.usage === undefined ? usage : value.usage;
    if (embeddedUsage !== undefined) {
      const usageResult = validateUsage(embeddedUsage, budget);
      if (!usageResult.ok) return usageResult;
      return { ok: true, value: { ...content.value, usage: usageResult.value } };
    }
    return content;
  }
  const content = validateTextOutput(value, budget);
  if (!content.ok || !usage) return content;
  return { ok: true, value: { ...content.value, usage } };
}

export function validateAiModelOutput(
  value: unknown,
  budgetValue: Partial<AiBudget> = {},
  usage?: AiUsage,
): AiGuardResult<{ content: string; usage?: AiUsage }> {
  const result = validateModelOutput(value, budgetValue, usage);
  if (!result.ok) return result;
  return { ok: true, value: usage ? { ...result.value, usage } : result.value };
}

export function validateAndSanitizeModelOutput(
  value: unknown,
  budgetValue: Partial<AiBudget> = {},
  usage?: AiUsage,
): AiGuardResult<{ content: string; usage?: AiUsage }> {
  return validateAiModelOutput(value, budgetValue, usage);
}

function validateRequestShape(value: unknown, budget: AiBudget): AiGuardResult<Record<string, unknown>> {
  if (!isObject(value)) return failure('invalid_request', 'AI request must be an object');
  const allowed = new Set(['tenant_id', 'actor_id', 'action', 'input', 'resident_id', 'stream', 'is_deidentified', 'field_values', 'input_tokens', 'fan_out', 'max_output_tokens', 'max_cost_cents']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return failure('invalid_request', 'AI request contains unknown fields');
  if (!isNonEmptyString(value.tenant_id) || !isNonEmptyString(value.actor_id) || !isNonEmptyString(value.action) || !ALLOWED_ACTIONS.has(value.action)) return failure('invalid_request', 'AI request identity or action is invalid');
  if (typeof value.input !== 'string' || !AI_INPUT_TOKEN_SET.has(value.input)) return failure('invalid_request', 'AI input must be a server-controlled structured action');
  if (value.input_tokens !== undefined && (typeof value.input_tokens !== 'number' || !Number.isInteger(value.input_tokens) || value.input_tokens < 0 || value.input_tokens > budget.maxInputTokens)) return failure('budget_exceeded', 'input token budget exceeds its limit');
  if (value.fan_out !== undefined && !isBoundedInteger(value.fan_out, budget.maxFanOut)) return failure('budget_exceeded', 'fan-out exceeds its budget');
  if (value.max_output_tokens !== undefined && !isBoundedInteger(value.max_output_tokens, budget.maxOutputTokens)) return failure('budget_exceeded', 'output token budget exceeds its limit');
  if (value.max_cost_cents !== undefined && (typeof value.max_cost_cents !== 'number' || !Number.isFinite(value.max_cost_cents) || value.max_cost_cents <= 0 || value.max_cost_cents > budget.maxCostCents)) return failure('budget_exceeded', 'cost budget exceeds its limit');
  if (value.resident_id !== undefined && !isNonEmptyString(value.resident_id)) return failure('invalid_request', 'resident_id is invalid');
  if (value.stream !== undefined && typeof value.stream !== 'boolean') return failure('invalid_request', 'stream is invalid');
  if (value.stream === true) return failure('invalid_request', 'streaming is disabled until the complete response can be validated');
  if (value.is_deidentified !== undefined && typeof value.is_deidentified !== 'boolean') return failure('invalid_request', 'is_deidentified is invalid');
  let fieldValues: Record<string, unknown> | undefined;
  if (value.field_values !== undefined) {
    const fields = validateDeidentifiedFieldValues(value.field_values, budget);
    if (!fields.ok) return fields;
    fieldValues = fields.value;
  }
  return {
    ok: true,
    value: {
      ...value,
      ...(fieldValues ? { field_values: fieldValues } : {}),
      fan_out: value.fan_out ?? 1,
      max_output_tokens: value.max_output_tokens ?? Math.min(1_024, budget.maxOutputTokens),
      max_cost_cents: value.max_cost_cents ?? Math.min(10, budget.maxCostCents),
    },
  };
}

export function authorizeAiRequest(
  request: unknown,
  context: AiPrincipal | AiAuthorizationContext,
  options: { requireAal2?: boolean; requireDeidentified?: boolean } = {},
): AiGuardResult<Record<string, unknown>> {
  const principal = principalFrom(context);
  if (!principal) return failure('invalid_context', 'AI authorization context is invalid');
  if (!isObject(request)) return failure('invalid_request', 'AI request must be an object');
  const allowedFields = new Set(['tenant_id', 'actor_id', 'action', 'input', 'resident_id', 'stream', 'is_deidentified', 'field_values', 'input_tokens', 'fan_out', 'max_output_tokens', 'max_cost_cents']);
  if (Object.keys(request).some((key) => !allowedFields.has(key))) return failure('invalid_request', 'AI request contains unknown fields');
  if (principal.status !== undefined && principal.status !== 'active') return failure('account_inactive', 'AI principal is not active');
  if (request.tenant_id !== principal.tenantId) return failure('tenant_mismatch', 'AI tenant scope does not match the principal');
  if (request.actor_id !== principal.actorId) return failure('actor_mismatch', 'AI actor does not match the principal');
  if (!isNonEmptyString(request.action) || !ALLOWED_ACTIONS.has(request.action)) return failure('invalid_request', 'AI action is invalid');
  const allowedActions = 'principal' in context && context.allowedActions ? context.allowedActions : ROLE_ACTIONS[principal.role];
  if (!allowedActions || !Array.from(allowedActions).includes(request.action)) return failure('action_forbidden', 'AI action is not authorized for the principal');
  if (options.requireAal2 || PRIVILEGED_ACTIONS.has(request.action)) {
    if (principal.aal !== 'aal2') return failure('aal2_required', 'AI privileged action requires server-verified AAL2');
  }
  if (options.requireDeidentified) {
    if (!Object.prototype.hasOwnProperty.call(request, 'field_values')) return failure('deidentification_required', 'AI input must contain server-validated structured fields');
    const fields = validateDeidentifiedFieldValues(request.field_values);
    if (!fields.ok) return failure('deidentification_required', 'AI structured fields failed validation');
  }
  return { ok: true, value: request as Record<string, unknown> };
}

export function validateAiRequest(
  request: unknown,
  context: AiPrincipal | AiAuthorizationContext,
  options: { requireAal2?: boolean; requireDeidentified?: boolean; budget?: Partial<AiBudget> } = {},
): AiGuardResult<Record<string, unknown>> {
  const budget = readBudget(options.budget);
  if (!budget) return failure('budget_exceeded', 'requested budget exceeds the hard limit');
  const shape = validateRequestShape(request, budget);
  if (!shape.ok) return shape;
  const authorization = authorizeAiRequest(shape.value, context, options);
  if (!authorization.ok) return authorization;
  return shape;
}

export function assertAiRequest(
  request: unknown,
  context: AiPrincipal | AiAuthorizationContext,
  options: { requireAal2?: boolean; requireDeidentified?: boolean; budget?: Partial<AiBudget> } = {},
): Record<string, unknown> {
  const result = validateAiRequest(request, context, options);
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  return result.value;
}

export function assertModelOutput(
  value: unknown,
  budget: Partial<AiBudget> = {},
  usage?: AiUsage,
): { content: string; usage?: AiUsage } {
  const result = validateAiModelOutput(value, budget, usage);
  if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
  return result.value;
}

export const aiGuard = {
  AI_FIELD_ALLOWLIST,
  AI_NORMALIZED_FIELD_ALLOWLIST,
  DEFAULT_AI_BUDGET,
  authorizeAiRequest,
  containsPhi,
  enforceAiBudget,
  findPhi,
  hasUnsafeAiContent,
  transformDeidentifiedFieldValues,
  validateAiModelOutput,
  validateAiRequest,
  validateAndSanitizeModelOutput,
  validateDeidentifiedFieldValues,
  validateModelOutput,
  validateStructuredFieldNames,
  validateStructuredOutput,
};
