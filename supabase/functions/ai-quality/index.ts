import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticate, corsHeaders, escapeHtml } from '../_shared/auth.ts';

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

const AI_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
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
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
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
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter API error: ${res.status} ${await res.text()}`);
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
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? '{}';
  }

  if (provider === 'azure') {
    const baseUrl = endpoint_url?.replace(/\/$/, '') ?? `https://${model.split('.')[0]}.openai.azure.com`;
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
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      },
    );
    if (!res.ok) throw new Error(`Azure API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '{}';
  }

  if (provider === 'custom' && endpoint_url) {
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
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`Custom AI API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? data.content?.[0]?.text ?? '{}';
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

function validateScores(parsed: any): QualityScores {
  const completeness = Math.max(0, Math.min(100, Math.round(Number(parsed.completeness ?? 0))));
  const specificity = Math.max(0, Math.min(100, Math.round(Number(parsed.specificity ?? 0))));
  const classification = Math.max(0, Math.min(100, Math.round(Number(parsed.classification ?? 0))));
  const overall = Math.max(0, Math.min(100, Math.round(Number(parsed.overall ?? 0))));
  return { completeness, specificity, classification, overall };
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId, role } = authResult;

  // Only supervisors, directors, institution_admins, and admins can use quality scoring
  const authorizedRoles = ['supervisor', 'director', 'institution_admin', 'admin'];
  if (!authorizedRoles.includes(role)) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions: requires supervisor or higher role' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  let body: AiQualityPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
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
  const { data: caseEntry, error: caseError } = await supabase
    .from('case_entries')
    .select(`
      id,
      tenant_id,
      resident_id,
      patient_mrn,
      patient_dob,
      case_date,
      field_values,
      status,
      created_at,
      updated_at,
      case_templates!inner(id, name, specialty, fields, required_fields)
    `)
    .eq('id', case_entry_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single();

  if (caseError || !caseEntry) {
    console.error('Failed to fetch case entry', { error: caseError?.message });
    return new Response(
      JSON.stringify({ error: 'Case entry not found' }),
      { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  const template = caseEntry.case_templates as any;
  const fieldValues = (caseEntry.field_values as Record<string, any>) ?? {};
  const requiredFields: string[] = (template.required_fields ?? []) as string[];
  const templateFields: string[] = Array.isArray(template.fields)
    ? template.fields as string[]
    : typeof template.fields === 'object' && template.fields !== null
      ? Object.keys(template.fields as Record<string, any>)
      : [];

  // Determine missing fields
  const missingFields = requiredFields.filter((f) => {
    const val = fieldValues[f];
    return val === undefined || val === null || val === '' || val === '[]' || val === '{}';
  });

  const analyzedFieldCount = Object.keys(fieldValues).length;

  // Build prompt for AI
  const systemPrompt = `You are a clinical case entry quality assessment assistant. Analyze surgery/case log entries and provide structured quality scores.

Return a JSON object with these fields:
- "completeness": number 0-100 — how completely the entry fills in fields
- "specificity": number 0-100 — how specific and detailed the entry is
- "classification": number 0-100 — how accurately classified/categorized the case is
- "overall": number 0-100 — overall quality score
- "suggestions": string[] — specific actionable suggestions for improvement

Be objective and consistent in scoring. Return valid JSON only.`;

  const userPrompt = `Analyze the quality of this case entry:

Template Name: ${template.name ?? 'N/A'}
Template Specialty: ${template.specialty ?? 'N/A'}
Case Date: ${caseEntry.case_date ?? 'N/A'}
Status: ${caseEntry.status}
Template Fields: ${templateFields.join(', ')}
Required Fields: ${requiredFields.join(', ')}
Missing Required Fields: ${missingFields.join(', ') || 'None'}

Field Values (JSON):
${JSON.stringify(fieldValues, null, 2)}

Provide completeness, specificity, classification, and overall scores (0-100), and specific suggestions for improvement.`;

  // Fetch AI config from the secret view (handles decryption)
  const { data: aiConfig, error: configError } = await supabase
    .from('secret_ai_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();

  if (configError || !aiConfig) {
    return new Response(
      JSON.stringify({ error: 'No active AI configuration found for this tenant' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

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
    console.error('AI provider call failed', { error: msg });
    return new Response(
      JSON.stringify({ error: 'AI provider error', detail: msg }),
      { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }

  // Parse AI response
  let parsed: any;
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

  const scores = validateScores(parsed);
  const suggestions: string[] = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

  const result: QualityResult = {
    scores,
    suggestions,
    analyzed_fields: analyzedFieldCount,
    missing_fields: missingFields,
  };

  // Log the quality assessment
  await supabase.from('ai_query_logs').insert({
    tenant_id: tenantId,
    resident_id: caseEntry.resident_id,
    query: `Quality scoring for case ${case_entry_id}`,
    response: JSON.stringify(result),
    model: aiConfig.model as string,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
});
