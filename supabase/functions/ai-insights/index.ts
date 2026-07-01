import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticate, corsHeaders, escapeHtml } from '../_shared/auth.ts';

function sanitizeQuery(input: string): string {
  const trimmed = input.slice(0, 1000);
  const sanitized = trimmed.replace(/[^a-zA-Z0-9\s.,!?;:'()\-_@\/]/g, '');
  return sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
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
    console.error('Rate limit check error:', error);
    return true;
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

async function getCachedResponse(supabase: any, tenantId: string, residentId: string, queryHash: string) {
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
    memoryCache.set(queryHash, {
      response: data.response_text,
      tokens: data.tokens_used,
      expires: Date.now() + CACHE_TTL_MS,
    });
    return memoryCache.get(queryHash);
  }
  return null;
}

async function setCachedResponse(
  supabase: any,
  tenantId: string,
  residentId: string,
  queryHash: string,
  query: string,
  response: string,
  tokens: number,
  model: string,
  provider: string
) {
  evictStaleCache();
  memoryCache.set(queryHash, { response, tokens, expires: Date.now() + CACHE_TTL_MS });

  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  await supabase.from('ai_response_cache').upsert({
    tenant_id: tenantId,
    resident_id: residentId,
    query_hash: queryHash,
    query_text: query,
    response_text: response,
    tokens_used: tokens,
    model,
    provider,
    expires_at: expiresAt,
  }, { onConflict: 'tenant_id,resident_id,query_hash' });
}

async function computeQueryHash(query: string, model: string, tenantId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(query + model + tenantId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const DIAGNOSIS_PATTERNS = /(patient has|diagnosed with|suffers from|condition is|presenting with classic|indicative of|consistent with.*disease)/i;
const PRESCRIPTION_PATTERNS = /(prescribe|take \d+\s*mg|dosage of|administer|recommend.*medication|start.*treatment\s+with)/i;
const PROGNOSIS_PATTERNS = /(will recover|likely to develop|prognosis is|life expectancy|expected outcome|will resolve)/i;

function checkSafety(text: string): string[] {
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
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { supabase, user, tenantId, role } = authResult;

  let body: { resident_id?: string; query?: string; stream?: boolean; is_deidentified?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { resident_id, query: rawQuery, stream = false, is_deidentified } = body;
  const query = rawQuery ? sanitizeQuery(rawQuery) : undefined;

  if (!resident_id) {
    return new Response(
      JSON.stringify({ error: 'resident_id is required' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  // Security: Verify resident_id matches caller OR caller has elevated role
  // This prevents cross-resident PHI access
  const callerId = user.id;
  const elevatedRoles = ['supervisor', 'director', 'institution_admin', 'admin'];
  if (resident_id !== callerId && !elevatedRoles.includes(role)) {
    return new Response(
      JSON.stringify({ error: 'Forbidden - resident_id mismatch' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (is_deidentified !== true) {
    return new Response(
      JSON.stringify({ error: 'Cannot send identifiable patient data to external AI. Set is_deidentified=true or remove PHI.' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: aiToggle, error: toggleError } = await supabase
    .from('resident_ai_toggle')
    .select('enabled, quota_limit, quota_used')
    .eq('tenant_id', tenantId)
    .eq('resident_id', resident_id)
    .maybeSingle();

  if (toggleError || !aiToggle || !aiToggle.enabled) {
    return new Response(
      JSON.stringify({ error: 'AI insights are not enabled for this resident' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (aiToggle.quota_limit != null && aiToggle.quota_used != null && aiToggle.quota_used >= aiToggle.quota_limit) {
    return new Response(
      JSON.stringify({ error: 'AI query quota exceeded' }),
      { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (!await checkRateLimitDb(supabase, tenantId, resident_id)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Please wait before making another request.' }),
      { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: aiConfig, error: configError } = await supabase
    .from('ai_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();

  if (configError || !aiConfig) {
    return new Response(
      JSON.stringify({ error: 'No active AI configuration found for this tenant' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: cases, error: casesError } = await supabase
    .from('case_entries')
    .select(`
      case_date,
      field_values,
      case_templates!inner(name, specialty)
    `)
    .eq('resident_id', resident_id)
    .eq('tenant_id', tenantId)
    .eq('status', 'approved')
    .eq('is_deidentified', true)
    .order('created_at', { ascending: false })
    .limit(50);

  if (casesError) {
    console.error('Failed to fetch case data', { error: casesError.message });
    return new Response(
      JSON.stringify({ error: 'Failed to fetch case data' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const caseSummary = (cases ?? []).map((c: any) => {
    const template = c.case_templates as any;
    const fieldCount = c.field_values ? Object.keys(c.field_values).length : 0;
    return `Date: ${c.case_date}, Specialty: ${template?.specialty ?? 'N/A'}, Template: ${template?.name ?? 'N/A'}, Field Count: ${fieldCount}`;
  }).join('\n');

  const systemPrompt = `You are an educational clinical reflection assistant for medical residents using E-Logbook. You analyze de-identified surgical and clinical case entries to provide educational insights.

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

  const userPrompt = query
    ? `The resident has asked: "${query}"\n\nHere are their recent approved de-identified cases for context:\n${caseSummary}\n\nPlease respond to their query using the case data above as context.`
    : `Please analyze the following approved de-identified case entries for this medical resident. Provide insights on:\n1. Case volume and distribution by specialty\n2. Patterns in case complexity or types\n3. Suggested areas for development or additional exposure\n4. Any notable trends\n\nHere are the cases:\n${caseSummary}`;

  const provider = aiConfig.provider as string;
  const model = aiConfig.model as string;
  const apiKey = aiConfig.encrypted_api_key as string;

  const queryForCache = query || 'Auto-analysis';
  const queryHash = await computeQueryHash(queryForCache, model, tenantId);
  const cached = await getCachedResponse(supabase, tenantId, resident_id, queryHash);
  if (cached) {
    return new Response(
      JSON.stringify({
        response: cached.response,
        tokens_used: cached.tokens,
        disclaimer_rendered: true,
        safety_flags: [],
        model,
        cached: true,
      }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  let aiResponse: string;
  let tokensUsed: number | null = null;

  try {
    if (provider === 'openai') {
      const openaiRes = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
        }),
      });

      if (!openaiRes.ok) {
        console.error('OpenAI API error', { status: openaiRes.status, body: await openaiRes.text() });
        return new Response(
          JSON.stringify({ error: 'AI provider error' }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }

      const openaiData = await openaiRes.json();
      aiResponse = openaiData.choices?.[0]?.message?.content ?? 'No response generated.';
      tokensUsed = openaiData.usage?.total_tokens ?? null;
    } else if (provider === 'openrouter') {
      const openrouterRes = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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
          temperature: 0.7,
        }),
      });

      if (!openrouterRes.ok) {
        console.error('OpenRouter API error', { status: openrouterRes.status, body: await openrouterRes.text() });
        return new Response(
          JSON.stringify({ error: 'AI provider error' }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }

      const openrouterData = await openrouterRes.json();
      aiResponse = openrouterData.choices?.[0]?.message?.content ?? 'No response generated.';
      tokensUsed = openrouterData.usage?.total_tokens ?? null;
    } else if (provider === 'anthropic') {
      const anthropicRes = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
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

      if (!anthropicRes.ok) {
        console.error('Anthropic API error', { status: anthropicRes.status, body: await anthropicRes.text() });
        return new Response(
          JSON.stringify({ error: 'AI provider error' }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }

      const anthropicData = await anthropicRes.json();
      aiResponse = anthropicData.content?.[0]?.text ?? 'No response generated.';
      tokensUsed = (anthropicData.usage?.input_tokens ?? 0) + (anthropicData.usage?.output_tokens ?? 0);
    } else if (provider === 'azure') {
      const allowedAzureModels = ['gpt-4', 'gpt-4-32k', 'gpt-35-turbo', 'gpt-35-turbo-16k'];
      const normalizedModel = model.toLowerCase().replace(/_/g, '-');
      if (!allowedAzureModels.some(m => normalizedModel.startsWith(m.toLowerCase()))) {
        return new Response(
          JSON.stringify({ error: 'Invalid Azure model specified' }),
          { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }
      const baseUrl = aiConfig.endpoint_url?.replace(/\/$/, '') ?? `https://${aiConfig.model.split('.')[0]}.openai.azure.com`;
      if (!await isValidEndpoint(baseUrl, 'azure')) {
        return new Response(
          JSON.stringify({ error: 'Invalid Azure endpoint URL' }),
          { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }
      const azureRes = await fetchWithTimeout(`${baseUrl}/openai/deployments/${model}/chat/completions?api-version=2024-02-15-preview`, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
        }),
      });

      if (!azureRes.ok) {
        console.error('Azure API error', { status: azureRes.status, body: await azureRes.text() });
        return new Response(
          JSON.stringify({ error: 'AI provider error' }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }

      const azureData = await azureRes.json();
      aiResponse = azureData.choices?.[0]?.message?.content ?? 'No response generated.';
      tokensUsed = azureData.usage?.total_tokens ?? null;
    } else if (provider === 'custom') {
      const endpointUrl = aiConfig.endpoint_url;
      if (!endpointUrl) {
        return new Response(
          JSON.stringify({ error: 'Custom provider requires an endpoint_url' }),
          { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }
      if (!await isValidEndpoint(endpointUrl, 'custom')) {
        return new Response(
          JSON.stringify({ error: 'Invalid or blocked custom endpoint URL' }),
          { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }

      const customRes = await fetchWithTimeout(endpointUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
        }),
      });

      if (!customRes.ok) {
        console.error('Custom provider API error', { status: customRes.status, body: await customRes.text() });
        return new Response(
          JSON.stringify({ error: 'AI provider error' }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }

      const customData = await customRes.json();
      aiResponse = customData.choices?.[0]?.message?.content ?? customData.content ?? 'No response generated.';
      tokensUsed = customData.usage?.total_tokens ?? null;
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${escapeHtml(provider)}` }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.error('AI provider request timed out', { provider, model });
      return new Response(
        JSON.stringify({ error: 'AI provider request timed out' }),
        { status: 504, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }
    console.error('AI provider unexpected error', { error: err instanceof Error ? err.message : String(err) });
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (!stream) {
    const safetyFlags = checkSafety(aiResponse);
    aiResponse = ensureDisclaimer(aiResponse);

    await setCachedResponse(supabase, tenantId, resident_id, queryHash, queryForCache, aiResponse, tokensUsed ?? 0, model, provider);

    await supabase.from('ai_query_logs').insert({
      tenant_id: tenantId,
      resident_id,
      query: query || 'Auto-analysis',
      response: aiResponse,
      tokens_used: tokensUsed,
      disclaimer_rendered: aiResponse.includes('does not constitute medical advice'),
      response_format: 'text',
      safety_flags: safetyFlags,
    });

    return new Response(
      JSON.stringify({ response: aiResponse, tokens_used: tokensUsed, disclaimer_rendered: true, safety_flags: safetyFlags, model }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const sseStream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = '';
      const safetyFlags: string[] = [];
      let abortedForSafety = false;

      // ALWAYS send the disclaimer first — before any AI content.
      // The client renders this as a banner and only then streams content.
      controller.enqueue(encoder.encode(`event: disclaimer\ndata: ${JSON.stringify({ text: 'This response is generated by an AI and does not constitute medical advice, diagnosis, or treatment. Always consult a qualified healthcare professional.' })}\n\n`));

      async function streamResponse() {
        try {
          if (provider === 'openai') {
            const openaiRes = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], temperature: 0.7, stream: true }),
            });
            const reader = openaiRes.body?.getReader();
            if (!reader) { controller.close(); return; }
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value);
              const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
              for (const line of lines) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const token = parsed.choices?.[0]?.delta?.content ?? '';
                  if (token) {
                    fullResponse += token;
                    // Safety check on EVERY chunk — abort if a flag trips.
                    const chunkFlags = checkSafety(fullResponse);
                    if (chunkFlags.length > 0) {
                      safetyFlags.push(...chunkFlags);
                      abortedForSafety = true;
                      controller.enqueue(encoder.encode(`event: safety\ndata: ${JSON.stringify({ flags: chunkFlags, message: 'Response blocked by safety policy' })}\n\n`));
                      controller.close();
                      return;
                    }
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
                  }
                } catch { /* skip parse errors */ }
              }
            }
          } else {
            // Non-streaming providers: chunk once.
            const chunkFlags = checkSafety(aiResponse);
            if (chunkFlags.length > 0) {
              safetyFlags.push(...chunkFlags);
              abortedForSafety = true;
              controller.enqueue(encoder.encode(`event: safety\ndata: ${JSON.stringify({ flags: chunkFlags })}\n\n`));
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: aiResponse })}\n\n`));
            fullResponse = aiResponse;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'AI provider request timed out' })}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : 'Stream error' })}\n\n`));
          }
        }

        if (abortedForSafety) return;

        const flags = checkSafety(fullResponse);
        const finalResponse = ensureDisclaimer(fullResponse);
        const disclaimerRendered = finalResponse.includes('does not constitute medical advice');

        await setCachedResponse(supabase, tenantId, resident_id, queryHash, queryForCache, finalResponse, tokensUsed ?? 0, model, provider);

        await supabase.from('ai_query_logs').insert({
          tenant_id: tenantId,
          resident_id,
          query: query || 'Auto-analysis',
          response: finalResponse,
          tokens_used: tokensUsed,
          disclaimer_rendered: disclaimerRendered,
          response_format: 'stream',
          safety_flags: flags,
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, tokens_used: tokensUsed, disclaimer_rendered: disclaimerRendered, safety_flags: flags })}\n\n`));
        controller.close();
      }

      streamResponse();
    },
  });

  return new Response(sseStream, {
    headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
});