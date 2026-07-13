// P1.4: SSO disabled until complete SAML/OIDC implementation is verified.
// Returns an explicit disabled response instead of redirecting to IdP.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
  return new Response(
    JSON.stringify({ error: 'SSO is disabled. Enterprise SSO is not yet available.' }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
});
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
