import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { authorizePrincipal, requirePrincipal, corsHeaders } from '../_shared/auth.ts';
import { containsPhi, hasUnsafeAiContent, validateAiRequest, validateAndSanitizeModelOutput, validateDeidentifiedFieldValues } from '../_shared/ai-guard.ts';
import { AI_INPUT_TOKENS, AI_INTENTS } from '../../../packages/shared/src/schemas/ai-contract.ts';
import { configuredOutboundHosts, outboundRequestText } from '../_shared/outbound-request.ts';
import { logError, logWarn } from '../_shared/logging.ts';

const AI_BUDGET = {
  maxInputBytes: 16_384,
  maxOutputBytes: 32_768,
  maxInputTokens: 8_192,
  maxOutputTokens: 2_048,
  maxCostCents: 100,
  maxFanOut: 1,
} as const;

export const AI_CACHE_POLICY_VERSION = 'ai-cache-v3';

export type CacheKeyInput = {
  query: string;
  structuredInput?: Record<string, unknown>;
  model: string;
  tenantId: string;
  residentId?: string;
  profileId?: string;
  provider: string;
  policyVersion?: string;
  policy_version?: string;
};

export type ProviderConfig = {
  provider: string;
  model: string;
  apiKey: string;
  endpointUrl?: string | null;
};

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;
export type EndpointValidator = (url: string, provider: string) => Promise<boolean>;

export type ProviderResult = {
  provider: string;
  content?: string;
  tokensUsed: number | null;
  response?: Response;
};

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly status?: number;

  constructor(provider: string, status?: number) {
    super('AI provider request failed');
    this.name = 'ProviderRequestError';
    this.provider = provider;
    this.status = status;
  }
}

export class UnsupportedProviderError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super('Unsupported AI provider');
    this.name = 'UnsupportedProviderError';
    this.provider = provider;
  }
}

export class MissingStreamReaderError extends Error {
  constructor() {
    super('AI provider response has no stream reader');
    this.name = 'MissingStreamReaderError';
  }
}

export class StreamSafetyAbortError extends Error {
  readonly flags: string[];

  constructor(flags: string[]) {
    super('AI stream blocked by safety policy');
    this.name = 'StreamSafetyAbortError';
    this.flags = flags;
  }
}

export type ResidentTarget = {
  id: string;
  tenant_id: string;
  role: string;
  status: string;
  deleted_at?: string | null;
};

export function isActiveResidentTarget(
  target: ResidentTarget | null | undefined,
  tenantId: string,
  residentId: string,
): boolean {
  return Boolean(
    target
      && target.id === residentId
      && target.tenant_id === tenantId
      && target.role === 'resident'
      && target.status === 'active'
      && !target.deleted_at,
  );
}

export function createIdempotentRelease(release: () => Promise<void>): () => Promise<void> {
  let attempt: Promise<void> | undefined;
  return () => {
    if (!attempt) {
      attempt = Promise.resolve()
        .then(release)
        .catch(() => undefined);
    }
    return attempt;
  };
}

export async function runWithQuotaRelease<T>(
  release: () => Promise<void>,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await release();
    throw error;
  }
}

type EdgeSupabaseClient = ReturnType<typeof createClient>;
type RpcResponse = { data?: unknown; error?: { message?: string } | null };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResponse> };
type LogClient = { from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<unknown> } };
type CacheClient = { from: (table: string) => { upsert: (row: Record<string, unknown>, options: Record<string, unknown>) => PromiseLike<unknown> } };
type CachedResponseRow = { response_text: string; tokens_used: number };
type SubscriptionRow = { subscription_plans?: { features?: Record<string, unknown> } | null } | null;
type InsightCase = {
  case_templates?: { specialty?: string | null } | null;
};

function callRpc(client: unknown, name: string, args: Record<string, unknown>): Promise<RpcResponse> {
  return (client as RpcClient).rpc(name, args);
}

type ProfileQueryBuilder = {
  select: (columns: string) => ProfileQueryBuilder;
  eq: (column: string, value: unknown) => ProfileQueryBuilder;
  maybeSingle: () => PromiseLike<{ data?: unknown; error?: unknown }>;
};

type ProfileClient = { from: (table: string) => ProfileQueryBuilder };

export async function findActiveResidentTarget(
  client: unknown,
  tenantId: string,
  residentId: string,
): Promise<ResidentTarget | null> {
  try {
    const result = await (client as ProfileClient)
      .from('profiles')
      .select('id, tenant_id, role, status, deleted_at')
      .eq('id', residentId)
      .eq('tenant_id', tenantId)
      .eq('role', 'resident')
      .eq('status', 'active')
      .maybeSingle();
    if (result.error || !result.data || typeof result.data !== 'object') return null;
    const target = result.data as ResidentTarget;
    return isActiveResidentTarget(target, tenantId, residentId) ? target : null;
  } catch {
    return null;
  }
}

export async function releaseAiQuota(client: unknown, reservationId: string): Promise<void> {
  const response = await callRpc(client, 'release_ai_quota', { p_reservation_id: reservationId });
  if (response.error) throw new Error('AI quota release failed');
}

function insertAiLog(client: unknown, row: Record<string, unknown>): PromiseLike<unknown> {
  return (client as LogClient).from('ai_query_logs').insert(row);
}

function stripControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  }).join('');
}

export function sanitizeQuery(input: string): string {
  const trimmed = input.slice(0, 1000);
  const sanitized = trimmed.replace(/[^a-zA-Z0-9\s.,!?;:'()\-_@\/]/g, '');
  return stripControlCharacters(sanitized).trim();
}

const PHI_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\d[ -]*?){13,16}\b/,
  /\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/,
  /\b(?:mrn|medical record(?: number)?|ssn|social security(?: number)?)\s*[:#=-]?\s*[A-Z0-9-]{4,}\b/i,
  /\b(?:patient|resident)\s+(?:name|date of birth|dob|phone|address|email)\b/i,
];

export function containsPotentialPhi(value: string): boolean {
  return PHI_PATTERNS.some((pattern) => pattern.test(value));
}

export function deidentifyAiText(value: string): string | null {
  const cleaned = stripControlCharacters(value).trim();
  if (!cleaned || containsPotentialPhi(cleaned) || containsPhi(cleaned)) return null;
  return cleaned;
}

const MANDATORY_DISCLAIMER = 'This is an educational reflection tool and does not constitute medical advice.';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 200;
const memoryCache = new Map<string, { response: string; tokens: number; expires: number }>();

function evictStaleCache(): void {
  const now = Date.now();
  for (const [key, val] of memoryCache) {
    if (val.expires <= now) memoryCache.delete(key);
  }
  if (memoryCache.size > CACHE_MAX_SIZE) {
    const entries = [...memoryCache.entries()].sort((a, b) => a[1].expires - b[1].expires);
    const toDelete = entries.slice(0, entries.length - CACHE_MAX_SIZE);
    for (const [key] of toDelete) memoryCache.delete(key);
  }
}

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60000;

async function checkRateLimitDb(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  residentId: string
): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from('ai_query_logs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('resident_id', residentId)
    .gte('created_at', since);

  if (error) {
    logError('ai.rate_limit_check_failed', error, { operation: 'rate_limit_check' });
    return false;
  }

  return (count ?? 0) < RATE_LIMIT_MAX;
}

const ALLOWED_AZURE_DOMAINS = ['openai.azure.com'];
const PRIVATE_IP_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^0\./, /^169\.254\./, /^::1$/, /^fc00:/, /^fe80:/,
];

async function isValidEndpoint(urlStr: string, provider: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (provider === 'azure') {
    const hostnameParts = url.hostname.split('.');
    if (hostnameParts.length < 2) return false;
    const domain = hostnameParts.slice(-2).join('.');
    return ALLOWED_AZURE_DOMAINS.includes(domain);
  }
  if (provider === 'custom') {
    const hostname = url.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return false;
    if (PRIVATE_IP_RANGES.some((r) => r.test(hostname))) return false;
    try {
      const addresses = await Deno.resolveDns(hostname, 'A');
      for (const addr of addresses) {
        if (addr.startsWith('10.') || addr.startsWith('192.168.') ||
            addr.startsWith('127.') || addr.startsWith('169.254.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export function sanitizeCachedResponse(value: unknown): string | null {
  const sanitized = validateAndSanitizeModelOutput(value, AI_BUDGET);
  return sanitized.ok ? sanitized.value.content : null;
}

async function getCachedResponse(supabase: EdgeSupabaseClient, tenantId: string, residentId: string, queryHash: string) {
  evictStaleCache();
  const mem = memoryCache.get(queryHash);
  if (mem && mem.expires > Date.now()) {
    return mem;
  }

  const { data } = await supabase
    .from('ai_response_cache')
    .select('response_text, tokens_used')
    .eq('tenant_id', tenantId)
    .eq('resident_id', residentId)
    .eq('query_hash', queryHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (data) {
    const cached = data as unknown as CachedResponseRow;
    if (typeof cached.response_text !== 'string' || typeof cached.tokens_used !== 'number') return null;
    const safeResponse = sanitizeCachedResponse(cached.response_text);
    if (safeResponse === null) return null;
    memoryCache.set(queryHash, {
      response: safeResponse,
      tokens: cached.tokens_used,
      expires: Date.now() + CACHE_TTL_MS,
    });
    return memoryCache.get(queryHash);
  }
  return null;
}

async function setCachedResponse(
  supabase: EdgeSupabaseClient,
  tenantId: string,
  residentId: string,
  queryHash: string,
  response: string,
  tokens: number,
  model: string,
  provider: string
) {
  const safeResponse = sanitizeCachedResponse(response);
  if (safeResponse === null) throw new Error('AI response failed the cache safety boundary');
  evictStaleCache();
  memoryCache.set(queryHash, { response: safeResponse, tokens, expires: Date.now() + CACHE_TTL_MS });

  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  await (supabase as unknown as CacheClient).from('ai_response_cache').upsert({
    tenant_id: tenantId,
    resident_id: residentId,
    query_hash: queryHash,
    query_text: '[HASHED]',
    response_text: safeResponse,
    tokens_used: tokens,
    model,
    provider,
    expires_at: expiresAt,
  }, { onConflict: 'tenant_id,resident_id,query_hash' });
}

export async function computeQueryHash(input: CacheKeyInput): Promise<string> {
  const residentId = input.residentId ?? input.profileId;
  const profileId = input.profileId ?? residentId;
  if (!residentId || !profileId) throw new Error('cache identity is required');
  if (![input.tenantId, input.provider, input.model].every((value) => typeof value === 'string' && value.length > 0)) throw new Error('cache scope is required');
  if (!new Set<string>(AI_INPUT_TOKENS).has(input.query)) throw new Error('cache query token is invalid');
  const structured = input.structuredInput ?? { status: 'approved' };
  const structuredResult = validateDeidentifiedFieldValues(structured);
  if (!structuredResult.ok) throw new Error('cache structured input is invalid');
  const material = JSON.stringify({
    policy_version: input.policyVersion ?? input.policy_version ?? AI_CACHE_POLICY_VERSION,
    tenant_id: input.tenantId,
    resident_id: residentId,
    profile_id: profileId,
    provider: input.provider,
    model: input.model,
    query_token: input.query,
    structured_input: structuredResult.value,
  });
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const DIAGNOSIS_PATTERNS = /(patient has|diagnosed with|suffers from|condition is|presenting with classic|indicative of|consistent with.*disease)/i;
const PRESCRIPTION_PATTERNS = /(prescribe|take \d+\s*mg|dosage of|administer|recommend.*medication|start.*treatment\s+with)/i;
const PROGNOSIS_PATTERNS = /(will recover|likely to develop|prognosis is|life expectancy|expected outcome|will resolve)/i;

export function checkSafety(text: string): string[] {
  const flags: string[] = [];
  if (DIAGNOSIS_PATTERNS.test(text)) flags.push('blocked_diagnosis');
  if (PRESCRIPTION_PATTERNS.test(text)) flags.push('blocked_prescription');
  if (PROGNOSIS_PATTERNS.test(text)) flags.push('blocked_prognosis');
  return flags;
}

function ensureDisclaimer(text: string): string {
  if (text.includes('does not constitute medical advice')) return text;
  const safetyFlags = checkSafety(text);
  let result = text;
  if (safetyFlags.length > 0) {
    result = `Note: Some content was filtered to comply with medical safety guidelines.\n\n${result}`;
  }
  return `${result}\n\n---\n${MANDATORY_DISCLAIMER}`;
}

const AI_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  const builtInHosts = ['api.openai.com', 'openrouter.ai', 'api.anthropic.com'];
  const isBuiltIn = builtInHosts.includes(parsed.hostname) || parsed.hostname.endsWith('.openai.azure.com');
  const result = await outboundRequestText(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    timeoutMs: AI_TIMEOUT_MS,
    maxResponseBytes: 1_048_576,
    maxConcurrent: 8,
    allowedHosts: isBuiltIn ? [parsed.hostname] : configuredOutboundHosts(),
    requireAllowlist: !isBuiltIn,
  });
  if (result.data === undefined) {
    if (result.category === 'timeout') throw new DOMException('AI provider request timed out', 'AbortError');
    throw new Error('OUTBOUND_REQUEST_BLOCKED');
  }
  return new Response(result.data, {
    status: result.status,
    headers: { 'Content-Type': result.category === 'success' ? 'application/json' : 'text/plain' },
  });
}


type ProviderCallOptions = {
  stream?: boolean;
  fetchImpl?: ProviderFetch;
  validateEndpoint?: EndpointValidator;
};

function providerMessages(systemPrompt: string, userPrompt: string) {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

function providerText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    if (typeof choice === 'object' && choice !== null) {
      const message = (choice as Record<string, unknown>).message;
      if (typeof message === 'object' && message !== null) {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === 'string') return content;
      }
    }
  }
  const content = record.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (typeof first === 'object' && first !== null && typeof (first as Record<string, unknown>).text === 'string') {
      return (first as Record<string, string>).text;
    }
  }
  return null;
}

function providerTokens(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const usage = (data as Record<string, unknown>).usage;
  if (typeof usage !== 'object' || usage === null) return null;
  const record = usage as Record<string, unknown>;
  const total = record.total_tokens;
  if (typeof total === 'number' && Number.isFinite(total)) return total;
  const input = record.input_tokens;
  const output = record.output_tokens;
  if (typeof input === 'number' && typeof output === 'number') return input + output;
  return null;
}

export async function callAiProvider(
  config: ProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  options: ProviderCallOptions = {},
): Promise<ProviderResult> {
  const provider = config.provider;
  const validateEndpoint = options.validateEndpoint ?? isValidEndpoint;
  const fetchImpl = options.fetchImpl ?? fetchWithTimeout;
  let url: string;
  let init: RequestInit;

  if (provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    init = {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: providerMessages(systemPrompt, userPrompt),
        max_tokens: 2048,
        temperature: 0.7,
        ...(options.stream ? { stream: true } : {}),
      }),
    };
  } else if (provider === 'openrouter') {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    init = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://elogbook.dev',
        'X-Title': 'E-Logbook',
      },
      body: JSON.stringify({
        model: config.model,
        messages: providerMessages(systemPrompt, userPrompt),
        max_tokens: 2048,
        temperature: 0.7,
      }),
    };
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    init = {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    };
  } else if (provider === 'azure') {
    const allowedAzureModels = ['gpt-4', 'gpt-4-32k', 'gpt-35-turbo', 'gpt-35-turbo-16k'];
    const normalizedModel = config.model.toLowerCase().replace(/_/g, '-');
    if (!allowedAzureModels.some((model) => normalizedModel.startsWith(model.toLowerCase()))) {
      throw new ProviderRequestError(provider);
    }
    const baseUrl = config.endpointUrl?.replace(/\/$/, '') ?? `https://${config.model.split('.')[0]}.openai.azure.com`;
    if (!await validateEndpoint(baseUrl, 'azure')) throw new ProviderRequestError(provider);
    url = `${baseUrl}/openai/deployments/${config.model}/chat/completions?api-version=2024-02-15-preview`;
    init = {
      method: 'POST',
      headers: { 'api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: providerMessages(systemPrompt, userPrompt),
        max_tokens: 2048,
        temperature: 0.7,
      }),
    };
  } else if (provider === 'custom') {
    if (!config.endpointUrl || !await validateEndpoint(config.endpointUrl, 'custom')) {
      throw new ProviderRequestError(provider);
    }
    url = config.endpointUrl;
    init = {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: providerMessages(systemPrompt, userPrompt),
        max_tokens: 2048,
        temperature: 0.7,
      }),
    };
  } else {
    throw new UnsupportedProviderError(provider);
  }

  const response = await fetchImpl(url, init);
  if (!response.ok) throw new ProviderRequestError(provider, response.status);
  if (options.stream && provider === 'openai') {
    return { provider, response, tokensUsed: null };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ProviderRequestError(provider, response.status);
  }
  const content = providerText(data);
  if (content === null) throw new ProviderRequestError(provider, response.status);
  return { provider, content, tokensUsed: providerTokens(data) };
}

export async function consumeOpenAiStream(
  response: Response,
  onToken: (token: string) => void,
  onSafety?: (flags: string[]) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new MissingStreamReaderError();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  let fullResponseBytes = 0;

  const processLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const choices = (parsed as Record<string, unknown>).choices;
    if (!Array.isArray(choices) || choices.length === 0) return;
    const choice = choices[0];
    if (typeof choice !== 'object' || choice === null) return;
    const delta = (choice as Record<string, unknown>).delta;
    if (typeof delta !== 'object' || delta === null) return;
    const token = (delta as Record<string, unknown>).content;
    if (typeof token === 'string' && token.length > 0) {
      fullResponseBytes += new TextEncoder().encode(token).byteLength;
      if (fullResponseBytes > 1_048_576) throw new StreamSafetyAbortError(['output_budget']);
      fullResponse += token;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) processLine(line);
  }
  buffer += decoder.decode();
  if (buffer) processLine(buffer);

  const flags = hasUnsafeAiContent(fullResponse)
    ? ['unsafe_content']
    : deidentifyAiText(fullResponse) === null
      ? ['phi_content']
      : checkSafety(fullResponse);
  if (flags.length > 0) {
    onSafety?.(flags);
    throw new StreamSafetyAbortError(flags);
  }
  onToken(fullResponse);
  return fullResponse;
}

if (import.meta.main) {
  serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await requirePrincipal(req, {
    roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'],
    aal: 'aal1',
  });
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId, role, principal } = authResult;
  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let body: { tenant_id?: unknown; resident_id?: unknown; intent?: unknown; query?: unknown; stream?: unknown; is_deidentified?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  if (!body || typeof body !== 'object') {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  const allowedBodyFields = new Set(['tenant_id', 'resident_id', 'intent', 'query', 'stream', 'is_deidentified']);
  if (Object.keys(body).some((key) => !allowedBodyFields.has(key))) {
    return new Response(
      JSON.stringify({ error: 'AI request contains unsupported fields' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { resident_id: rawResidentId, intent: rawIntent, query: rawQuery, stream: rawStream, is_deidentified: rawIsDeidentified } = body;
  if (typeof rawResidentId !== 'string' || rawResidentId.length === 0) {
    return new Response(
      JSON.stringify({ error: 'resident_id is required' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  if (rawQuery !== undefined) {
    return new Response(
      JSON.stringify({ error: 'Free-text queries are not accepted; choose a structured intent.' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  if (rawStream === true) {
    return new Response(
      JSON.stringify({ error: 'Streaming is temporarily disabled until complete response validation is available.' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  if (rawStream !== undefined && typeof rawStream !== 'boolean') {
    return new Response(
      JSON.stringify({ error: 'stream must be boolean' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  if (rawIsDeidentified !== undefined) {
    return new Response(
      JSON.stringify({ error: 'De-identification is derived from the server record; client flags are not accepted.' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  if (rawIntent !== undefined && (typeof rawIntent !== 'string' || !new Set<string>(AI_INTENTS).has(rawIntent))) {
    return new Response(
      JSON.stringify({ error: 'intent must be a supported structured value' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  const resident_id = rawResidentId;
  if (principal.role === 'resident' && resident_id !== principal.profileId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
  const privilegedResident = principal.role !== 'resident';
  if (principal.role !== 'resident') {
    const privileged = authorizePrincipal(principal, { aal: 'aal2' });
    if (!privileged.ok) return privileged.response;
  }
  const intent = typeof rawIntent === 'string' ? rawIntent : 'overview';
  const inputToken = intent === 'trends'
    ? 'insights-trends'
    : intent === 'development'
      ? 'insights-development'
      : intent === 'case-mix'
        ? 'auto-analysis'
        : 'insights-overview';

  const target = await findActiveResidentTarget(serviceSupabase, tenantId, resident_id);
  if (!target) {
    return new Response(
      JSON.stringify({ error: 'Resident is not active in the authenticated tenant' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (!await checkRateLimitDb(supabase, tenantId, resident_id)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Please wait before making another request.' }),
      { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  // Check plan gating: AI is only available if features.ai = true
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('subscription_plans!inner(features)')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();
  const planFeatures = (sub as SubscriptionRow)?.subscription_plans?.features ?? null;

  if (!planFeatures || planFeatures.ai !== true) {
    return new Response(
      JSON.stringify({ error: 'AI features not available on your plan' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  let aiConfig: { id: string; tenant_id: string; provider: string; model: string; endpoint_url: string | null; api_key: string } | null = null;
  let configError: unknown = null;

  const { data: rawConfig, error: rawConfigError } = await serviceSupabase
    .from('ai_config')
    .select('id, tenant_id, provider, model, endpoint_url, api_key_enc, key_version, is_active')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();
  configError = rawConfigError;

  if (rawConfig && !rawConfigError) {
    const { data: decrypted, error: decError } = await serviceSupabase.rpc('decrypt_with_version', {
      p_encrypted: rawConfig.api_key_enc,
      p_version: rawConfig.key_version,
    });
    if (decError || !decrypted) {
      configError = decError ?? new Error('decrypt failed');
    } else {
      aiConfig = {
        id: rawConfig.id,
        tenant_id: rawConfig.tenant_id,
        provider: rawConfig.provider,
        model: rawConfig.model,
        endpoint_url: rawConfig.endpoint_url,
        api_key: decrypted as string,
      };
    }
  }

  // Fallback to platform-default AI key
  if (!aiConfig && !configError) {
    const platformKey = Deno.env.get('PLATFORM_OPENAI_KEY');
    if (platformKey) {
      aiConfig = {
        id: 'platform',
        tenant_id: '00000000-0000-0000-0000-000000000000',
        provider: 'openai',
        api_key: platformKey,
        model: 'gpt-4o-mini',
        endpoint_url: null,
      } as unknown as { id: string; tenant_id: string; provider: string; model: string; endpoint_url: string | null; api_key: string };
    }
  }

  if (!aiConfig) {
    return new Response(
      JSON.stringify({ error: 'No active AI configuration found for this tenant' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: cases, error: casesError } = await supabase
    .from('case_entries')
    .select(`
      case_templates!inner(specialty)
    `)
    .eq('resident_id', resident_id)
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')
    .eq('is_deidentified', true)
    .order('created_at', { ascending: false })
    .limit(50);

  if (casesError) {
    logError('ai.case_fetch_failed', casesError, { operation: 'case_fetch' });
    return new Response(
      JSON.stringify({ error: 'Failed to fetch case data' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const specialtyValues = [...new Set((cases ?? [])
    .map((rawCase) => (rawCase as InsightCase).case_templates?.specialty)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim()))].slice(0, 8);
  const structuredFieldResult = validateDeidentifiedFieldValues({
    case_type: specialtyValues.length > 0 ? specialtyValues : ['none'],
    status: 'approved',
  }, AI_BUDGET);
  if (!structuredFieldResult.ok) {
    return new Response(
      JSON.stringify({ error: 'Case context contains disallowed data' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
  const structuredFieldValues = structuredFieldResult.value;

  const aiRequest = validateAiRequest(
    {
      tenant_id: tenantId,
      actor_id: principal.profileId,
      action: 'ai:insights',
      input: inputToken,
      resident_id,
      field_values: structuredFieldValues,
      fan_out: 1,
    },
    { actorId: principal.profileId, tenantId, role, status: 'active', aal: principal.aal },
    { requireAal2: privilegedResident, requireDeidentified: true, budget: AI_BUDGET },
  );
  if (!aiRequest.ok) {
    return new Response(
      JSON.stringify({ error: aiRequest.reason === 'budget_exceeded' ? 'AI request exceeds the allowed budget' : 'AI request is not authorized' }),
      { status: aiRequest.reason === 'budget_exceeded' ? 400 : 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  const systemPrompt = `You are an educational clinical reflection assistant for medical residents using E-Logbook. Analyze only the bounded structured fields supplied below.

You MAY:
- Identify clinical patterns and trends across cases
- Suggest areas for further study and skill development
- Cite relevant medical guidelines as educational references
- Ask reflective questions to encourage clinical growth

You MUST NOT:
- Diagnose medical conditions
- Prescribe medications or recommend dosages
- Make prognosis statements
- Recommend specific treatments

All data you receive is de-identified. You must not attempt to re-identify patients.

Every response MUST end with: "This is an educational reflection tool and does not constitute medical advice."

Be concise, supportive, and evidence-based.`;

  const userPrompt = `Structured intent: ${inputToken}
Structured case fields: ${JSON.stringify(structuredFieldValues)}

Provide educational insights about the supplied case distribution and development opportunities.`;

  const provider = aiConfig.provider as string;
  const model = aiConfig.model as string;
  const apiKey = aiConfig.api_key as string;

  const queryHash = await computeQueryHash({
    query: inputToken,
    structuredInput: structuredFieldValues,
    model,
    tenantId,
    residentId: resident_id,
    profileId: principal.profileId,
    provider,
    policyVersion: AI_CACHE_POLICY_VERSION,
  });
  const cached = await getCachedResponse(supabase, tenantId, resident_id, queryHash);
  if (cached) {
    const cachedOutput = validateAndSanitizeModelOutput(cached.response, AI_BUDGET, {
      outputTokens: cached.tokens,
      totalTokens: cached.tokens,
      costCents: Math.ceil(cached.tokens / 1_000),
    });
    if (!cachedOutput.ok || checkSafety(cachedOutput.value.content).length > 0) {
      return new Response(
        JSON.stringify({ error: 'Cached AI response failed the output safety boundary' }),
        { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        response: cachedOutput.value.content,
        tokens_used: cached.tokens,
        disclaimer_rendered: true,
        safety_flags: [],
        model,
        cached: true,
      }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: quota, error: quotaError } = await callRpc(supabase, 'consume_ai_quota', {
    p_resident_id: resident_id,
    p_count: 1,
  });
  const quotaRecord = quota as { code?: unknown; reservation_id?: unknown } | null;
  const reservationId = quotaRecord?.reservation_id;
  if (
    quotaError
    || quotaRecord?.code !== 'ok'
    || typeof reservationId !== 'string'
    || reservationId.length === 0
  ) {
    return new Response(
      JSON.stringify({ error: 'AI query quota exceeded or AI is disabled' }),
      { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }
  const releaseReservation = createIdempotentRelease(() => releaseAiQuota(serviceSupabase, reservationId));

  let aiResponse = '';
  let tokensUsed: number | null = null;
  try {
    const providerResult = await callAiProvider(
      { provider, model, apiKey, endpointUrl: aiConfig.endpoint_url },
      systemPrompt,
      userPrompt,
      { stream: false },
    );
    aiResponse = providerResult.content ?? '';
    tokensUsed = providerResult.tokensUsed;
  } catch (err) {
    await releaseReservation();
    if (err instanceof DOMException && err.name === 'AbortError') {
      logWarn('ai.provider_timeout', { provider, model });
      return new Response(
        JSON.stringify({ error: 'AI provider request timed out' }),
        { status: 504, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }
    logError('ai.provider_error', err, { provider, model });
    return new Response(
      JSON.stringify({ error: err instanceof UnsupportedProviderError ? 'AI provider is not supported' : 'AI provider error' }),
      { status: err instanceof UnsupportedProviderError ? 400 : 502, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const estimatedInputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
    const estimatedOutputTokens = tokensUsed === null
      ? Math.ceil(aiResponse.length / 4)
      : Math.max(0, tokensUsed - estimatedInputTokens);
    const totalTokens = tokensUsed ?? estimatedInputTokens + estimatedOutputTokens;
    const guardedOutput = validateAndSanitizeModelOutput(aiResponse, AI_BUDGET, {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      totalTokens,
      costCents: Math.ceil(totalTokens / 1_000),
    });

    if (!guardedOutput.ok) throw new Error('AI response failed the output safety boundary');
    const safetyFlags = checkSafety(guardedOutput.value.content);
    if (safetyFlags.length > 0) throw new Error('AI response was blocked by safety policy');
    const finalResponse = ensureDisclaimer(guardedOutput.value.content);

    await setCachedResponse(supabase, tenantId, resident_id, queryHash, finalResponse, tokensUsed ?? 0, model, provider);
    await insertAiLog(supabase, {
      tenant_id: tenantId,
      resident_id,
      query: '[HASHED]',
      response: '[REDACTED]',
      tokens_used: tokensUsed,
      disclaimer_rendered: finalResponse.includes('does not constitute medical advice'),
      response_format: 'text',
      safety_flags: safetyFlags,
    });

    return new Response(
      JSON.stringify({ response: finalResponse, tokens_used: tokensUsed, disclaimer_rendered: true, safety_flags: safetyFlags, model }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    await releaseReservation();
    logError('ai.response_processing_failed', error, { provider, model });
    return new Response(
      JSON.stringify({ error: 'AI response failed the output safety boundary' }),
      { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }
});
}