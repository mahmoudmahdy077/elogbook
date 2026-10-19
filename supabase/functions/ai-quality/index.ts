import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { requirePrincipal, corsHeaders } from '../_shared/auth.ts';
import { transformDeidentifiedFieldValues, validateAiRequest, validateDeidentifiedFieldValues, validateStructuredFieldNames, validateStructuredOutput } from '../_shared/ai-guard.ts';
import { configuredOutboundHosts, outboundRequestText } from '../_shared/outbound-request.ts';
import { logError } from '../_shared/logging.ts';

const AI_BUDGET = {
  maxInputBytes: 16_384,
  maxOutputBytes: 16_384,
  maxInputTokens: 8_192,
  maxOutputTokens: 2_048,
  maxCostCents: 100,
  maxFanOut: 1,
} as const;

interface AiQualityPayload {
  case_entry_id: string;
  tenant_id: string;
}

interface QualityScores {
  completeness: number;
  specificity: number;
  classification: number;
  overall: number;
}

interface QualityResult {
  scores: QualityScores;
  suggestions: string[];
  analyzed_fields: number;
  missing_fields: string[];
}

interface QualityCaseEntry {
  is_deidentified: boolean;
  resident_id: string;
  status: string;
  field_values: Record<string, unknown>;
  case_templates: {
     specialty?: string | null;

    fields?: unknown;
    required_fields?: unknown;
  };
}

type LogResult = { error?: { message?: string } | null };
type LogClient = { from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<LogResult> } };

function insertQualityLog(client: unknown, row: Record<string, unknown>): PromiseLike<LogResult> {
  return (client as LogClient).from('ai_query_logs').insert(row);
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
  if (result.data === undefined) throw new Error('OUTBOUND_REQUEST_BLOCKED');
  return new Response(result.data, {
    status: result.status,
    headers: { 'Content-Type': result.category === 'success' ? 'application/json' : 'text/plain' },
  });
}

function isValidEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]') return false;
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const parts = ipv4Match.slice(1).map(Number);
      if (parts[0] === 10) return false;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
      if (parts[0] === 192 && parts[1] === 168) return false;
      if (parts[0] === 127) return false;
      if (parts[0] === 169 && parts[1] === 254) return false;
      if (parts[0] === 0 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function callAiProvider(
  config: { provider: string; model: string; api_key: string; endpoint_url?: string },
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const { provider, model, api_key, endpoint_url } = config;

  if (provider === 'openai') {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '{}';
  }

  if (provider === 'openrouter') {
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://elogbook.dev',
        'X-Title': 'E-Logbook',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '{}';
  }

  if (provider === 'anthropic') {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? '{}';
  }

  if (provider === 'azure') {
    const baseUrl = endpoint_url?.replace(/\/$/, '') ?? `https://${model.split('.')[0]}.openai.azure.com`;
    if (endpoint_url && !isValidEndpoint(endpoint_url)) throw new Error('INVALID_ENDPOINT');
    const res = await fetchWithTimeout(
      `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=2024-02-15-preview`,
      {
        method: 'POST',
        headers: {
          'api-key': api_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
           max_tokens: 2048,
           temperature: 0.2,
           response_format: { type: 'json_object' },
        }),
      },
    );
    if (!res.ok) throw new Error(`Azure API error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '{}';
  }

  if (provider === 'custom' && endpoint_url) {
    if (!isValidEndpoint(endpoint_url)) throw new Error('INVALID_ENDPOINT');
    const res = await fetchWithTimeout(endpoint_url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`Custom AI API error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? data.content?.[0]?.text ?? '{}';
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

function validateScores(parsed: Record<string, unknown>): QualityScores {
  const score = (key: string): number => {
    const value = parsed[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  };
  return {
    completeness: score('completeness'),
    specificity: score('specificity'),
    classification: score('classification'),
    overall: score('overall'),
  };
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await requirePrincipal(req, {
    roles: ['supervisor', 'director', 'institution_admin', 'admin'],
    aal: 'aal2',
  });
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId, role, principal } = authResult;

    let body: AiQualityPayload;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
      );
    }
     if (!body || typeof body !== 'object') {
       return new Response(
         JSON.stringify({ error: 'Invalid JSON body' }),
         { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
       );
     }
     if (Object.keys(body).some((key) => !['case_entry_id', 'tenant_id'].includes(key))) {
       return new Response(
         JSON.stringify({ error: 'AI request contains unsupported fields' }),
         { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
       );
     }

     const { case_entry_id, tenant_id } = body;


  if (!case_entry_id) {
    return new Response(
      JSON.stringify({ error: 'case_entry_id is required' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  if (!tenant_id) {
    return new Response(
      JSON.stringify({ error: 'tenant_id is required' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  if (tenant_id !== tenantId) {
    return new Response(
      JSON.stringify({ error: 'tenant_id mismatch' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  // Fetch the full case entry with template
  const { data: rawCaseEntry, error: caseError } = await supabase
    .from('case_entries')
    .select(`
      id,
      tenant_id,
      resident_id,
      field_values,
       status,
       is_deidentified,

       case_templates!inner(id, specialty, fields, required_fields)

    `)
    .eq('id', case_entry_id)
    .eq('tenant_id', tenantId)
    .eq('is_deidentified', true)
    .is('deleted_at', null)
    .single();

  const caseEntry = rawCaseEntry as QualityCaseEntry | null;
  if (caseError || !caseEntry) {
    logError('ai.case_fetch_failed', caseError, { operation: 'case_fetch' });
    return new Response(
      JSON.stringify({ error: 'Case entry not found' }),
      { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  if (caseEntry.is_deidentified !== true) {
    return new Response(
      JSON.stringify({ error: 'Case must be deidentified' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  const template = caseEntry.case_templates ?? {};
  const requiredFields = Array.isArray(template.required_fields)
    ? template.required_fields.filter((field): field is string => typeof field === 'string')
    : [];
  const templateFields: string[] = Array.isArray(template.fields)
    ? template.fields.filter((field): field is string => typeof field === 'string')
    : typeof template.fields === 'object' && template.fields !== null
      ? Object.keys(template.fields)
      : [];
  const templateKeyResult = validateStructuredFieldNames([...new Set([...templateFields, ...requiredFields])]);
  if (!templateKeyResult.ok) {
    return new Response(
      JSON.stringify({ error: 'Case template contains disallowed data' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }
  const structuredFieldResult = transformDeidentifiedFieldValues(caseEntry.field_values ?? {}, AI_BUDGET);
  if (!structuredFieldResult.ok) {
    return new Response(
      JSON.stringify({ error: 'Case contains disallowed or potentially identifying data' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }
  const fieldValues = { ...structuredFieldResult.value } as Record<string, unknown>;
  if (typeof template.specialty === 'string') fieldValues.specialty = template.specialty;
  if (typeof caseEntry.status === 'string') fieldValues.status = caseEntry.status;
  const fieldValuesResult = validateDeidentifiedFieldValues(fieldValues, AI_BUDGET);
  if (!fieldValuesResult.ok) {
    return new Response(
      JSON.stringify({ error: 'Case contains disallowed or potentially identifying data' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }
  const structuredFieldValues = fieldValuesResult.value;
  const canonicalFieldNames = Object.keys(templateKeyResult.value);
  const canonicalRequiredFields = canonicalFieldNames.filter((field) => requiredFields.some((name) => name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === field.replace(/_/g, '')));
  const missingFields = canonicalRequiredFields.filter((field) => {
    const value = structuredFieldValues[field];
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  });

  const analyzedFieldCount = Object.keys(structuredFieldValues).length;

  const aiRequest = validateAiRequest(
    {
      tenant_id: tenantId,
      actor_id: principal.profileId,
      action: 'ai:quality',
      input: 'quality-assessment',
      field_values: structuredFieldValues,
    },
    { actorId: principal.profileId, tenantId, role, status: 'active', aal: principal.aal },
    { requireAal2: true, requireDeidentified: true, budget: AI_BUDGET },
  );
  if (!aiRequest.ok) {
    return new Response(
      JSON.stringify({ error: aiRequest.reason === 'budget_exceeded' ? 'AI request exceeds the allowed budget' : 'AI request is not authorized' }),
      { status: aiRequest.reason === 'budget_exceeded' ? 400 : 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  const systemPrompt = `You are a clinical case entry quality assessment assistant. Analyze only the bounded structured case fields supplied below and provide structured quality scores.

Return a JSON object with these fields:
- "completeness": number 0-100 — how completely the entry fills in fields
- "specificity": number 0-100 — how specific and detailed the entry is
- "classification": number 0-100 — how accurately classified/categorized the case is
- "overall": number 0-100 — overall quality score
- "suggestions": string[] — specific actionable suggestions for improvement

Be objective and consistent in scoring. Return valid JSON only.`;

  const userPrompt = `Analyze the quality of this structured case entry.

Structured Fields: ${JSON.stringify(structuredFieldValues)}
Required Fields: ${canonicalRequiredFields.join(', ') || 'None'}
Missing Required Fields: ${missingFields.join(', ') || 'None'}

Provide completeness, specificity, classification, and overall scores (0-100), and specific suggestions for improvement.`;

  // Fetch AI config via the service client: the secret views are role-gated
  // to tenant admins (Task 1.1), and the base table RLS only allows tenant
  // admins — supervisors must use the service client.
  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data: rawConfig, error: configError } = await serviceSupabase
    .from('ai_config')
    .select('id, tenant_id, provider, model, endpoint_url, api_key_enc, key_version, is_active')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();

  if (configError || !rawConfig) {
    return new Response(
      JSON.stringify({ error: 'No active AI configuration found for this tenant' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  const { data: decrypted, error: decError } = await serviceSupabase.rpc('decrypt_with_version', {
    p_encrypted: rawConfig.api_key_enc,
    p_version: rawConfig.key_version,
  });
  if (decError || !decrypted) {
    return new Response(
      JSON.stringify({ error: 'No active AI configuration found for this tenant' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  const aiConfig = {
    provider: rawConfig.provider as string,
    model: rawConfig.model as string,
    api_key: decrypted as string,
    endpoint_url: rawConfig.endpoint_url as string | undefined,
  };

  let aiResponseText: string;
  try {
    aiResponseText = await callAiProvider(
      {
        provider: aiConfig.provider as string,
        model: aiConfig.model as string,
        api_key: aiConfig.api_key as string,
        endpoint_url: aiConfig.endpoint_url as string | undefined,
      },
      systemPrompt,
      userPrompt,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === 'INVALID_ENDPOINT' ? 400 : 502;
    if (status === 502) logError('ai.provider_call_failed', err, { provider: aiConfig.provider, model: aiConfig.model });
    return new Response(
      JSON.stringify({ error: status === 400 ? 'Invalid endpoint URL' : 'AI provider error' }),
      { status, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  // Parse AI response
  let parsed: unknown;
  try {
    parsed = JSON.parse(aiResponseText);
  } catch {
    // Attempt to extract JSON from the response text
    const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return new Response(
          JSON.stringify({ error: 'Failed to parse AI response as JSON' }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } },
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI response as JSON' }),
        { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } },
      );
    }
  }

  const guardedOutput = validateStructuredOutput(parsed, 'quality', AI_BUDGET);
  if (!guardedOutput.ok) {
    return new Response(
      JSON.stringify({ error: 'AI response failed the output safety boundary' }),
      { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }
  const validatedParsed = guardedOutput.value;
  const scores = validateScores(validatedParsed);
  const suggestions: string[] = validatedParsed.suggestions as string[];

  const result: QualityResult = {
    scores,
    suggestions,
    analyzed_fields: analyzedFieldCount,
    missing_fields: missingFields,
  };

  const logResult = await insertQualityLog(supabase, {
    tenant_id: tenantId,
    resident_id: caseEntry.resident_id,
    query: '[HASHED]',
    response: '[REDACTED]',
    model: aiConfig.model as string,
    response_format: 'text',
    safety_flags: [],
  });
  if (logResult?.error) {
    logError('ai.quality_log_failed', logResult.error, { operation: 'quality_log' });
    return new Response(
      JSON.stringify({ error: 'AI quality result could not be recorded' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
});
