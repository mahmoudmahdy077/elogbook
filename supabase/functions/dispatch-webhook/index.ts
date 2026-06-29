// supabase/functions/dispatch-webhook/index.ts
// Phase 6 / P6.10 — tenant webhook dispatcher (stub).
//
// This function is invoked by Postgres triggers (case_entries,
// approval_requests) via pg_net. It looks up all active webhooks for
// the tenant that match the event type, signs the payload with the
// per-webhook secret using HMAC-SHA256, and POSTs to the URL.
//
// Production-ready delivery (retry, DLQ, per-event replay) is
// product-level work and out of scope for Phase 6. The dispatcher
// records a tenant_webhook_deliveries row for every attempt so the
// tenant admin UI can show delivery history.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encodeHex } from 'https://deno.land/std@0.168.0/encoding/hex.ts';

interface DispatchPayload {
  tenant_id: string;
  event_type: string;
  event_id: string;
  data: Record<string, unknown>;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return encodeHex(new Uint8Array(sig));
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'server misconfiguration' }), { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let payload: DispatchPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400 });
  }

  if (!payload.tenant_id || !payload.event_type || !payload.event_id) {
    return new Response(JSON.stringify({ error: 'missing required fields' }), { status: 400 });
  }

  const { data: webhooks, error: listError } = await supabase
    .from('tenant_webhooks')
    .select('id, url, secret, events')
    .eq('tenant_id', payload.tenant_id)
    .eq('is_active', true);

  if (listError) {
    return new Response(JSON.stringify({ error: listError.message }), { status: 500 });
  }

  const matches = (webhooks ?? []).filter((w) => Array.isArray(w.events) && w.events.includes(payload.event_type));

  const body = JSON.stringify(payload);
  const results: Array<{ webhook_id: string; status: number; ok: boolean }> = [];

  for (const wh of matches) {
    const signature = await hmacSha256Hex(wh.secret, body);
    const startedAt = Date.now();
    let status = 0;
    let respBody = '';
    let ok = false;
    try {
      const res = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-E-Logbook-Event': payload.event_type,
          'X-E-Logbook-Event-Id': payload.event_id,
          'X-E-Logbook-Signature': `sha256=${signature}`,
        },
        body,
      });
      status = res.status;
      respBody = await res.text().catch(() => '');
      ok = res.ok;
    } catch (err) {
      respBody = err instanceof Error ? err.message : String(err);
    }

    await supabase.from('tenant_webhook_deliveries').insert({
      webhook_id: wh.id,
      tenant_id: payload.tenant_id,
      event_type: payload.event_type,
      event_id: payload.event_id,
      status_code: status,
      request_body: body.slice(0, 8000),
      response_body: respBody.slice(0, 8000),
      attempted_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      succeeded: ok,
    });

    results.push({ webhook_id: wh.id, status, ok });
  }

  return new Response(JSON.stringify({ delivered: results.length, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
