import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { tenant_id, resident_id, query } = await req.json();

    if (!tenant_id || !resident_id) {
      return new Response(
        JSON.stringify({ error: 'tenant_id and resident_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: aiToggle, error: toggleError } = await supabase
      .from('resident_ai_toggle')
      .select('enabled')
      .eq('tenant_id', tenant_id)
      .eq('resident_id', resident_id)
      .maybeSingle();

    if (toggleError || !aiToggle || !aiToggle.enabled) {
      return new Response(
        JSON.stringify({ error: 'AI insights are not enabled for this resident' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: aiConfig, error: configError } = await supabase
      .from('ai_config')
      .select('*')
      .eq('tenant_id', tenant_id)
      .eq('is_active', true)
      .maybeSingle();

    if (configError || !aiConfig) {
      return new Response(
        JSON.stringify({ error: 'No active AI configuration found for this tenant' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: cases, error: casesError } = await supabase
      .from('case_entries')
      .select(`
        case_date,
        patient_mrn,
        field_values,
        case_templates!inner(name, specialty)
      `)
      .eq('resident_id', resident_id)
      .eq('tenant_id', tenant_id)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(50);

    if (casesError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch case data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const caseSummary = (cases ?? []).map((c: any) => {
      const template = c.case_templates as any;
      return `Date: ${c.case_date}, Specialty: ${template?.specialty ?? 'N/A'}, Template: ${template?.name ?? 'N/A'}, MRN: ${c.patient_mrn}, Fields: ${JSON.stringify(c.field_values ?? {})}`;
    }).join('\n');

    const systemPrompt = `You are a clinical AI assistant for medical residents using E-Logbook. You analyze surgical and clinical case entries to provide educational insights, identify patterns, suggest areas for improvement, and help residents reflect on their training. Be concise, supportive, and evidence-based. Do not provide medical diagnoses or treatment recommendations.`;

    const userPrompt = query
      ? `The resident has asked: "${query}"\n\nHere are their recent approved cases for context:\n${caseSummary}\n\nPlease respond to their query using the case data above as context.`
      : `Please analyze the following approved case entries for this medical resident. Provide insights on:\n1. Case volume and distribution by specialty\n2. Patterns in case complexity or types\n3. Suggested areas for development or additional exposure\n4. Any notable trends\n\nHere are the cases:\n${caseSummary}`;

    const provider = aiConfig.provider as string;
    const model = aiConfig.model as string;
    const apiKey = aiConfig.encrypted_api_key as string;
    let aiResponse: string;
    let tokensUsed: number | null = null;

    if (provider === 'openai') {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
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
        return new Response(
          JSON.stringify({ error: `OpenAI error: ${await openaiRes.text()}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const openaiData = await openaiRes.json();
      aiResponse = openaiData.choices?.[0]?.message?.content ?? 'No response generated.';
      tokensUsed = openaiData.usage?.total_tokens ?? null;
    } else if (provider === 'openrouter') {
      const openrouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        return new Response(
          JSON.stringify({ error: `OpenRouter error: ${await openrouterRes.text()}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const openrouterData = await openrouterRes.json();
      aiResponse = openrouterData.choices?.[0]?.message?.content ?? 'No response generated.';
      tokensUsed = openrouterData.usage?.total_tokens ?? null;
    } else if (provider === 'anthropic') {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
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
        return new Response(
          JSON.stringify({ error: `Anthropic error: ${await anthropicRes.text()}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const anthropicData = await anthropicRes.json();
      aiResponse = anthropicData.content?.[0]?.text ?? 'No response generated.';
      tokensUsed = (anthropicData.usage?.input_tokens ?? 0) + (anthropicData.usage?.output_tokens ?? 0);
    } else if (provider === 'azure') {
      const baseUrl = aiConfig.endpoint_url?.replace(/\/$/, '') ?? `https://${aiConfig.model.split('.')[0]}.openai.azure.com`;
      const azureRes = await fetch(`${baseUrl}/openai/deployments/${model}/chat/completions?api-version=2024-02-15-preview`, {
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
        return new Response(
          JSON.stringify({ error: `Azure error: ${await azureRes.text()}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const customRes = await fetch(endpointUrl, {
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
        return new Response(
          JSON.stringify({ error: `Custom provider error: ${await customRes.text()}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const customData = await customRes.json();
      aiResponse = customData.choices?.[0]?.message?.content ?? customData.content ?? 'No response generated.';
      tokensUsed = customData.usage?.total_tokens ?? null;
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${provider}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabase.from('ai_query_logs').insert({
      tenant_id,
      resident_id,
      query: query || 'Auto-analysis',
      response: aiResponse,
      tokens_used: tokensUsed,
    });

    return new Response(
      JSON.stringify({ response: aiResponse, tokens_used: tokensUsed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
