import { z } from 'zod';
import {
  AI_FIELD_KINDS,
  AI_INPUT_TOKENS,
  AI_MAX_CATEGORY_ITEMS,
  AI_MAX_CATEGORY_LENGTH,
  AI_MAX_DURATION_MINUTES,
  AI_MAX_INTEGER,
  AI_NORMALIZED_FIELD_NAMES,
  canonicalAiFieldName,
  normalizeAiFieldKey,
  type AiFieldKind,
  type AiFieldName,
} from './ai-contract';

export const AI_MAX_INPUT_BYTES = 32_768;
export const AI_MAX_OUTPUT_BYTES = 32_768;
export const AI_MAX_INPUT_TOKENS = 8_192;
export const AI_MAX_OUTPUT_TOKENS = 4_096;
export const AI_MAX_COST_CENTS = 100;
export const AI_MAX_FAN_OUT = 4;

const CONTROL_CONTENT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const EXECUTABLE_CONTENT = /(?:<\s*\/?\s*(?:script|iframe|object|embed|style|svg|img)\b|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|(?:^|[\s`])(?:rm\s+-rf|curl\s+|wget\s+|powershell(?:\.exe)?\s+|bash\s+-c|sh\s+-c)\b|\b(?:drop|truncate|alter)\s+table\b|\bunion\s+select\b)/i;
// The e-mail local part is bounded at RFC 5321's 64 octets. Unbounded, the
// leading `+` retries a whole run of matching characters from every offset it
// can start at, which is quadratic in a value this scan is handed for every
// in-budget request -- 32KB is ordinary input, not a mistake, so the byte
// budget above does not stand in for the bound.
const PHI_CONTENT = /(?:[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\d(). -]{7,}\d)|\b\d{1,5}\s+[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,4}\s+(?:STREET|ST|ROAD|RD|AVENUE|AVE|BOULEVARD|BLVD|LANE|LN|DRIVE|DR|COURT|CT|WAY|TERRACE|PLACE|PL)\b|\bP\.?\s*O\.?\s+BOX\s+\d+\b|\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{3}[- ]\d{2}[- ]\d{4}\b|\b(?:mrn|medical\s+record(?:\s+number)?|patient\s+record)\s*[:#=-]?\s*[A-Z0-9-]{4,}\b|\b\d{6,}\b|\b(?:Dr|Mr|Mrs|Ms|Miss)\.?\s+[A-Z][A-Z-]+(?:\s+[A-Z][A-Z-]+)+\b|\b(?:patient|resident)\s+[A-Z][A-Z-]+(?:\s+[A-Z][A-Z-]+)+\b)/i;
const CLINICAL_NAME_EXCLUSIONS = /\b(?:laparoscopic|appendectomy|surgery|medical|clinical|patient|resident|case|general|internal|medicine|emergency|cardiology|orthopedic|pediatric|neurology|recovery|hospital|clinic|institution|department|program|template|logbook|quality|assessment|service|system|follow[- ]?up|outpatient|inpatient|diagnos\w*|procedure|treatment|therapy|anesthesia|complication|my|new|the|this|age|group|adult|child|infant|neonate|older)\b/i;

const CATEGORY_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _./+()'-]{0,63}$/;
const DEIDENTIFIED_FIELD_ALLOWLIST = new Set(AI_NORMALIZED_FIELD_NAMES);

function hasLikelyPersonName(value: string): boolean {
  if (/\b(?:Dr|Mr|Mrs|Ms|Miss)\.?\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+)+\b/i.test(value)) return true;
  if (/\b[A-Z][A-Za-z'-]+,\s*[A-Z][A-Za-z'-]+\b/i.test(value)) return true;
  const matches = value.match(/\b[A-Z][a-z]{1,30}\s+[A-Z][a-z]{1,30}\b/g);
  return Boolean(matches?.some((match) => !CLINICAL_NAME_EXCLUSIONS.test(match)));
}

function hasUnsafeContent(value: string): boolean {
  return CONTROL_CONTENT.test(value) || EXECUTABLE_CONTENT.test(value) || PHI_CONTENT.test(value) || hasLikelyPersonName(value);
}

function isCategoryValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= AI_MAX_CATEGORY_LENGTH
    && CATEGORY_VALUE_PATTERN.test(normalized)
    && !hasUnsafeContent(normalized);
}

function isAllowedStructuredValue(field: AiFieldName, kind: AiFieldKind, value: unknown): boolean {
  if (kind === 'text_presence') return typeof value === 'boolean';
  if (kind === 'boolean') return typeof value === 'boolean';
  if (kind === 'category') return isCategoryValue(value);
  if (kind === 'integer') {
    const maximum = field === 'duration_minutes' ? AI_MAX_DURATION_MINUTES : AI_MAX_INTEGER;
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum && !hasUnsafeContent(String(value));
  }
  return Array.isArray(value)
    && value.length > 0
    && value.length <= AI_MAX_CATEGORY_ITEMS
    && value.every(isCategoryValue);
}

function isAllowedDeidentifiedTree(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean {
  if (depth > 4 || value === null || value === undefined || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) return false;
  seen.add(value);
  try {
    return Object.entries(value as Record<string, unknown>).every(([key, child]) => {
      const field = canonicalAiFieldName(key);
      return field !== null && DEIDENTIFIED_FIELD_ALLOWLIST.has(normalizeAiFieldKey(field)) && isAllowedStructuredValue(field, AI_FIELD_KINDS[field], child);
    });
  } finally {
    seen.delete(value);
  }
}

const safeText = (max: number, maxBytes = max) => z.string()
  .max(max)
  .refine((value) => {
    // Cheap byte-budget guard, evaluated before any DLP scan. A UTF-16 code
    // unit never encodes to fewer than one byte, so a string longer than the
    // byte budget is always over budget and can be rejected on length alone.
    // This guard aborts on failure so an over-budget value is never serialized.
    // It is not what keeps the scan affordable: the PHI patterns bound their own
    // repetition, because an in-budget value is the ordinary case.
    if (value.length > maxBytes) return false;
    return new TextEncoder().encode(value).byteLength <= maxBytes;
  }, { abort: true })
  .refine((value) => !hasUnsafeContent(value));

export const aiDeidentifiedFieldValuesSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  if (!isAllowedDeidentifiedTree(value)) {
    context.addIssue({ code: 'custom', message: 'field values contain a disallowed key or identifying value' });
  }
});

export const aiToolCallSchema = z.object({
  name: safeText(64),
  arguments: z.record(z.string(), z.unknown()).refine(
    (value) => Object.keys(value).length <= 20 && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 8_192,
  ),
}).strict();

export const aiUsageSchema = z.object({
  input_tokens: z.number().int().min(0).max(AI_MAX_INPUT_TOKENS),
  output_tokens: z.number().int().min(0).max(AI_MAX_OUTPUT_TOKENS),
  total_tokens: z.number().int().min(0).max(AI_MAX_INPUT_TOKENS + AI_MAX_OUTPUT_TOKENS),
  cost_cents: z.number().finite().min(0).max(AI_MAX_COST_CENTS),
}).strict().superRefine((value, context) => {
  if (value.total_tokens !== value.input_tokens + value.output_tokens) {
    context.addIssue({ code: 'custom', path: ['total_tokens'], message: 'total_tokens must equal input and output tokens' });
  }
});

export const aiModelOutputSchema = z.object({
  content: safeText(AI_MAX_OUTPUT_BYTES, AI_MAX_OUTPUT_BYTES),
  tool_calls: z.array(aiToolCallSchema).max(0).default([]),
  usage: aiUsageSchema.optional(),
}).strict();

export const aiTextOutputSchema = z.object({
  text: safeText(AI_MAX_OUTPUT_BYTES, AI_MAX_OUTPUT_BYTES),
}).strict();

export const aiQualityScoresSchema = z.object({
  completeness: z.number().finite().min(0).max(100),
  specificity: z.number().finite().min(0).max(100),
  classification: z.number().finite().min(0).max(100),
  overall: z.number().finite().min(0).max(100),
}).strict();

export const aiQualityOutputSchema = z.object({
  scores: aiQualityScoresSchema,
  suggestions: z.array(safeText(500)).max(8),
  analyzed_fields: z.number().int().min(0).max(10_000).optional(),
  missing_fields: z.array(safeText(200)).max(200).optional(),
}).strict();

export const aiGapOutputSchema = z.object({
  gaps: z.array(z.object({
    competency: safeText(200),
    current: z.number().finite().min(0).max(100_000),
    target: z.number().finite().min(0).max(100_000),
    gap: z.number().finite().min(0).max(100_000),
    recommendation: safeText(1_000),
  }).strict()).max(20),
  summary: safeText(2_000),
}).strict();

export const aiBudgetSchema = z.object({
  max_input_bytes: z.number().int().positive().max(AI_MAX_INPUT_BYTES),
  max_output_bytes: z.number().int().positive().max(AI_MAX_OUTPUT_BYTES),
  max_input_tokens: z.number().int().positive().max(AI_MAX_INPUT_TOKENS),
  max_output_tokens: z.number().int().positive().max(AI_MAX_OUTPUT_TOKENS),
  max_cost_cents: z.number().finite().positive().max(AI_MAX_COST_CENTS),
  max_fan_out: z.number().int().positive().max(AI_MAX_FAN_OUT),
}).strict();

export const aiRequestSchema = z.object({
  tenant_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  action: z.enum(['ai:insights', 'ai:quality', 'ai:gap-analysis', 'ai:completion']),
  input: z.enum(AI_INPUT_TOKENS),
  field_values: aiDeidentifiedFieldValuesSchema.optional(),
  is_deidentified: z.boolean().optional(),
  stream: z.boolean().default(false),
  input_tokens: z.number().int().min(0).max(AI_MAX_INPUT_TOKENS).optional(),
  max_output_tokens: z.number().int().positive().max(AI_MAX_OUTPUT_TOKENS).default(1_024),
  max_cost_cents: z.number().finite().positive().max(AI_MAX_COST_CENTS).default(10),
  fan_out: z.number().int().positive().max(AI_MAX_FAN_OUT).default(1),
}).strict().superRefine((value, context) => {
  if (value.stream) {
    context.addIssue({ code: 'custom', path: ['stream'], message: 'streaming is disabled until complete response validation is available' });
  }
  if (value.is_deidentified === true && value.field_values === undefined) {
    context.addIssue({ code: 'custom', path: ['field_values'], message: 'server-validated structured fields are required' });
  }
});

export const aiAuthorizationSchema = z.object({
  tenant_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  role: z.string().min(1).max(64),
  allowed_actions: z.array(z.string().min(1).max(64)).max(16),
}).strict();

export const aiQueryLogStatusSchema = z.enum(['pending', 'completed', 'failed', 'rate_limited', 'quota_exceeded']);

export const aiQueryLogSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  resident_id: z.string().uuid().nullable(),
  query: safeText(AI_MAX_INPUT_BYTES, AI_MAX_INPUT_BYTES).pipe(z.string().min(1)),
  response: safeText(AI_MAX_OUTPUT_BYTES, AI_MAX_OUTPUT_BYTES).nullable(),
  tokens_used: z.number().int().min(0).max(AI_MAX_INPUT_TOKENS + AI_MAX_OUTPUT_TOKENS).nullable(),
  model: z.string().max(200).nullable(),
  provider: z.string().max(64).nullable(),
  status: aiQueryLogStatusSchema.default('pending'),
  disclaimer_rendered: z.boolean().default(false),
  safety_flags: z.array(z.string().max(64)).max(32).default([]),
  response_format: z.enum(['json', 'stream']).default('json'),
  error_message: z.string().max(2_000).nullable(),
  created_at: z.string(),
}).strict();

export const aiResponseCacheSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  resident_id: z.string().uuid().nullable(),
  query_hash: z.string().length(64),
  query_text: safeText(AI_MAX_INPUT_BYTES, AI_MAX_INPUT_BYTES),
  response_text: safeText(AI_MAX_OUTPUT_BYTES, AI_MAX_OUTPUT_BYTES),
  model: z.string().max(200),
  provider: z.string().max(64),
  tokens_used: z.number().int().min(0).max(AI_MAX_INPUT_TOKENS + AI_MAX_OUTPUT_TOKENS),
  expires_at: z.string(),
  created_at: z.string(),
}).strict();

export const modelOutputSchema = aiModelOutputSchema;
export const aiOutputSchema = aiModelOutputSchema;
export const toolCallSchema = aiToolCallSchema;

export * from './ai-contract';

export type AiToolCall = z.infer<typeof aiToolCallSchema>;
export type AiModelOutput = z.infer<typeof aiModelOutputSchema>;
export type AiQualityOutput = z.infer<typeof aiQualityOutputSchema>;
export type AiGapOutput = z.infer<typeof aiGapOutputSchema>;
export type AiRequest = z.infer<typeof aiRequestSchema>;
export type AiBudget = z.infer<typeof aiBudgetSchema>;
