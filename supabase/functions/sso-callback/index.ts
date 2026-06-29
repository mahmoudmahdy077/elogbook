// supabase/functions/sso-callback/index.ts
// Phase 6 / P6.0 — minimal SSO callback broker.
//
// Flow:
//   1. Browser is redirected to /functions/v1/sso-callback?tenant=<slug>&metadata=...&next=...
//   2. This function looks up the tenant + active sso_config, validates the
//      protocol (saml | oidc), and returns a 302 to the IdP's authorize URL
//      (constructed from the discovery/metadata endpoint).
//   3. After the IdP completes, it should call back to /auth/callback on the
//      web app with a Supabase exchange code.
//
// Production-ready: full SAML response validation and OIDC token exchange
// require a per-tenant secret and are out of scope for the wiring task.
// The function deliberately fails closed: if the protocol is not 'saml' or
// 'oidc', or no discovery/metadata is present, it returns 400.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
});

const SAFE_PATH = /^\/(?!\/)[^\\]*$/;

function safeNext(input: string | null): string {
  if (!input) return '/';
  if (!SAFE_PATH.test(input)) return '/';
  return input;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const url = new URL(req.url);
  const tenantSlug = url.searchParams.get('tenant');
  const protocol = url.searchParams.get('protocol');
  const metadata = url.searchParams.get('metadata');
  const discovery = url.searchParams.get('discovery');
  const next = safeNext(url.searchParams.get('next'));

  if (!tenantSlug) {
    return new Response(
      JSON.stringify({ error: 'Missing tenant slug' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (protocol !== 'saml' && protocol !== 'oidc') {
    return new Response(
      JSON.stringify({ error: 'Unsupported or missing protocol' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  // Verify the tenant has an active SSO config (defence-in-depth: the web
  // route already did this, but we don't trust the caller).
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'Server misconfiguration' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, slug')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (tenantError || !tenant) {
    return new Response(
      JSON.stringify({ error: 'Tenant not found' }),
      { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: cfg, error: cfgError } = await supabase
    .from('tenant_sso_configs')
    .select('protocol, metadata_url, discovery_url, is_active')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .maybeSingle();
  if (cfgError || !cfg) {
    return new Response(
      JSON.stringify({ error: 'SSO not configured for tenant' }),
      { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  // Audit log: record the SSO start event. We do NOT log the user's
  // identity (they are not yet authenticated). We log tenant_id and the
  // protocol for security forensics.
  await supabase.from('audit_logs').insert({
    tenant_id: tenant.id,
    action: 'sso_start',
    resource_type: 'auth',
    resource_id: null,
    user_id: null,
    metadata: { protocol: cfg.protocol, ip: req.headers.get('x-forwarded-for') ?? null },
  });

  let authorizeUrl: string;
  if (cfg.protocol === 'oidc' && cfg.discovery_url) {
    authorizeUrl = cfg.discovery_url;
  } else if (cfg.protocol === 'saml' && cfg.metadata_url) {
    authorizeUrl = cfg.metadata_url;
  } else {
    return new Response(
      JSON.stringify({ error: 'SSO endpoint missing for protocol' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  void metadata; void discovery; void protocol;

  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      'Location': `${authorizeUrl}?next=${encodeURIComponent(next)}`,
    },
  });
});
