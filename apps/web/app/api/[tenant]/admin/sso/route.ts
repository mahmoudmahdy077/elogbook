import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

const ALLOWED_PROTOCOLS = ['saml', 'oidc'] as const;
const ALLOWED_ROLES = ['resident', 'supervisor', 'director', 'institution_admin'] as const;

// ---------------------------------------------------------------------------
// GET — list SSO configs for the tenant
// ---------------------------------------------------------------------------
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug, ['director', 'institution_admin', 'admin']);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const { profile } = _auth;

  // Plan gate: SSO is Enterprise-only
  const { data: planCheck } = await supabase
    .from('subscriptions')
    .select('subscription_plans!inner(features)')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();
  const features = (planCheck as { subscription_plans?: { features?: Record<string, unknown> } | null })?.subscription_plans?.features ?? null;
  if (!features?.sso) {
    return NextResponse.json({ error: 'Not available on your plan' }, { status: 503 });
  }

  const adminClient = createServiceRoleClient();
  const { data: configs, error } = await adminClient
    .from('tenant_sso_configs')
    .select('id, protocol, metadata_url, discovery_url, idp_entity_id, client_id, default_role, is_active, created_at, updated_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('sso list error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ configs: configs ?? [] });
}

// ---------------------------------------------------------------------------
// POST — create a new SSO config
// ---------------------------------------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`sso:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  let body: {
    protocol?: string;
    metadata_url?: string;
    discovery_url?: string;
    idp_entity_id?: string;
    idp_certificate?: string;
    client_id?: string;
    client_secret?: string;
    default_role?: string;
    is_active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    protocol,
    metadata_url,
    discovery_url,
    idp_entity_id,
    idp_certificate,
    client_id,
    client_secret,
    default_role,
    is_active,
  } = body;

  if (!protocol || !ALLOWED_PROTOCOLS.includes(protocol as typeof ALLOWED_PROTOCOLS[number])) {
    return NextResponse.json({
      error: `Protocol must be one of: ${ALLOWED_PROTOCOLS.join(', ')}`,
    }, { status: 400 });
  }

  if (default_role && !ALLOWED_ROLES.includes(default_role as typeof ALLOWED_ROLES[number])) {
    return NextResponse.json({
      error: `Role must be one of: ${ALLOWED_ROLES.join(', ')}`,
    }, { status: 400 });
  }

  if (protocol === 'saml' && !metadata_url) {
    return NextResponse.json({ error: 'SAML requires a metadata URL' }, { status: 400 });
  }
  if (protocol === 'oidc' && !discovery_url) {
    return NextResponse.json({ error: 'OIDC requires a discovery URL' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();

  // SEC2-002: store via RPC so the client secret is pgp_sym_encrypt'ed
  // in-database (migration 20261120000000) instead of written plaintext into
  // client_secret_encrypted by the service-role client.
  const { data: rpcResult, error: rpcError } = await supabase.rpc('store_sso_config', {
    p_protocol: protocol,
    p_metadata_url: metadata_url ?? null,
    p_discovery_url: discovery_url ?? null,
    p_idp_entity_id: idp_entity_id ?? null,
    p_idp_certificate: idp_certificate ?? null,
    p_client_id: client_id ?? null,
    p_client_secret: client_secret ?? null,
    p_default_role: default_role ?? 'resident',
    p_is_active: is_active ?? true,
  });

  if (rpcError) {
    if (rpcError.code === '23505') {
      return NextResponse.json({
        error: `A ${protocol} configuration already exists for this institution. Edit it instead.`,
      }, { status: 409 });
    }
    console.error('sso create error:', rpcError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const stored = rpcResult as { error?: string; id?: string } | null;
  if (stored?.error || !stored?.id) {
    return NextResponse.json({ error: stored?.error ?? 'Failed to create SSO configuration' }, { status: 400 });
  }

  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'sso_config_create', resource_type: 'tenant_sso_configs', resource_id: stored.id, changes: {} });

  return NextResponse.json({
    config: {
      id: stored.id,
      protocol,
      default_role: default_role ?? 'resident',
      is_active: is_active ?? true,
    },
  }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PUT — update an existing SSO config
// ---------------------------------------------------------------------------
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  let body: {
    id?: string;
    protocol?: string;
    metadata_url?: string;
    discovery_url?: string;
    idp_entity_id?: string;
    idp_certificate?: string;
    client_id?: string;
    client_secret?: string;
    default_role?: string;
    is_active?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    id,
    protocol,
    metadata_url,
    discovery_url,
    idp_entity_id,
    idp_certificate,
    client_id,
    client_secret,
    default_role,
    is_active,
  } = body;

  if (!id) {
    return NextResponse.json({ error: 'Config ID is required' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  const { data: existing } = await adminClient
    .from('tenant_sso_configs')
    .select('id, protocol, metadata_url, discovery_url, idp_entity_id, idp_certificate, client_id, default_role, is_active')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'SSO config not found' }, { status: 404 });
  }
  if (protocol && !ALLOWED_PROTOCOLS.includes(protocol as typeof ALLOWED_PROTOCOLS[number])) {
    return NextResponse.json({
      error: `Protocol must be one of: ${ALLOWED_PROTOCOLS.join(', ')}`,
    }, { status: 400 });
  }

  if (default_role && !ALLOWED_ROLES.includes(default_role as typeof ALLOWED_ROLES[number])) {
    return NextResponse.json({
      error: `Role must be one of: ${ALLOWED_ROLES.join(', ')}`,
    }, { status: 400 });
  }

  // SEC2-002: updates go through the RPC so a rotated client secret is
  // pgp_sym_encrypt'ed in-database. The RPC overwrites every non-secret
  // column it receives, so pass the current row merged with the requested
  // partial update (explicit nulls still clear a field, matching the old
  // direct-update behavior). The stored secret is left untouched unless a
  // new client_secret was provided.
  type ExistingSso = {
    protocol: string;
    metadata_url: string | null;
    discovery_url: string | null;
    idp_entity_id: string | null;
    idp_certificate: string | null;
    client_id: string | null;
    default_role: string;
    is_active: boolean;
  };
  const merged = { ...(existing as ExistingSso) };
  if (protocol !== undefined) merged.protocol = protocol;
  if (metadata_url !== undefined) merged.metadata_url = metadata_url;
  if (discovery_url !== undefined) merged.discovery_url = discovery_url;
  if (idp_entity_id !== undefined) merged.idp_entity_id = idp_entity_id;
  if (idp_certificate !== undefined) merged.idp_certificate = idp_certificate;
  if (client_id !== undefined) merged.client_id = client_id;
  if (default_role !== undefined) merged.default_role = default_role;
  if (is_active !== undefined) merged.is_active = is_active;

  const { data: rpcResult, error: rpcError } = await supabase.rpc('store_sso_config', {
    p_protocol: merged.protocol,
    p_metadata_url: merged.metadata_url,
    p_discovery_url: merged.discovery_url,
    p_idp_entity_id: merged.idp_entity_id,
    p_idp_certificate: merged.idp_certificate,
    p_client_id: merged.client_id,
    p_client_secret: client_secret ?? null,
    p_default_role: merged.default_role,
    p_is_active: merged.is_active,
    p_config_id: id,
  });

  if (rpcError) {
    console.error('sso update error:', rpcError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const stored = rpcResult as { error?: string } | null;
  if (stored?.error) {
    return NextResponse.json({ error: stored.error }, { status: 400 });
  }

  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'sso_config_update', resource_type: 'tenant_sso_configs', resource_id: id!, changes: {} });

  return NextResponse.json({ success: true });
}

// ---------------------------------------------------------------------------
// DELETE — delete an SSO config
// ---------------------------------------------------------------------------
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const { profile } = _auth;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Config ID is required' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();

  // Verify ownership
  const { data: existing } = await adminClient
    .from('tenant_sso_configs')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'SSO config not found' }, { status: 404 });
  }

  const { error: deleteError } = await adminClient
    .from('tenant_sso_configs')
    .delete()
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id);

  if (deleteError) {
    console.error('sso delete error:', deleteError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: _auth.user.id, action: 'sso_config_delete', resource_type: 'tenant_sso_configs', resource_id: id, changes: {} });

  return NextResponse.json({ success: true });
}
