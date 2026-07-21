import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Plan gate: SSO is Enterprise-only
  const { data: planCheck } = await supabase
    .from('subscriptions')
    .select('subscription_plans!inner(features)')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();
  const features = (planCheck as any)?.subscription_plans?.features as Record<string, unknown> | null;
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
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`sso:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

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

  // --- Validation ---
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

  // Protocol-specific requirements
  if (protocol === 'saml' && !metadata_url) {
    return NextResponse.json({ error: 'SAML requires a metadata URL' }, { status: 400 });
  }
  if (protocol === 'oidc' && !discovery_url) {
    return NextResponse.json({ error: 'OIDC requires a discovery URL' }, { status: 400 });
  }

  // Rate limit: max 1 config per protocol per tenant (unique constraint enforced by DB)
  const adminClient = createServiceRoleClient();

  const { error: insertError } = await adminClient
    .from('tenant_sso_configs')
    .insert({
      tenant_id: profile.tenant_id,
      protocol,
      metadata_url: metadata_url ?? null,
      discovery_url: discovery_url ?? null,
      idp_entity_id: idp_entity_id ?? null,
      idp_certificate: idp_certificate ?? null,
      client_id: client_id ?? null,
      client_secret_encrypted: client_secret ?? null,
      default_role: default_role ?? 'resident',
      is_active: is_active ?? true,
    })
    .select('id, protocol, metadata_url, discovery_url, idp_entity_id, client_id, default_role, is_active, created_at');

  if (insertError) {
    // Handle unique constraint violation
    if (insertError.code === '23505') {
      return NextResponse.json({
        error: `A ${protocol} configuration already exists for this institution. Edit it instead.`,
      }, { status: 409 });
    }
    console.error('sso create error:', insertError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ config: insertError ? null : body }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PUT — update an existing SSO config
// ---------------------------------------------------------------------------
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

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

  // Verify ownership
  const adminClient = createServiceRoleClient();
  const { data: existing } = await adminClient
    .from('tenant_sso_configs')
    .select('id, protocol')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'SSO config not found' }, { status: 404 });
  }

  // Validation
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

  const updatePayload: Record<string, unknown> = {};
  if (protocol !== undefined) updatePayload.protocol = protocol;
  if (metadata_url !== undefined) updatePayload.metadata_url = metadata_url;
  if (discovery_url !== undefined) updatePayload.discovery_url = discovery_url;
  if (idp_entity_id !== undefined) updatePayload.idp_entity_id = idp_entity_id;
  if (idp_certificate !== undefined) updatePayload.idp_certificate = idp_certificate;
  if (client_id !== undefined) updatePayload.client_id = client_id;
  if (client_secret !== undefined) updatePayload.client_secret_encrypted = client_secret;
  if (default_role !== undefined) updatePayload.default_role = default_role;
  if (is_active !== undefined) updatePayload.is_active = is_active;

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateError } = await adminClient
    .from('tenant_sso_configs')
    .update(updatePayload)
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id);

  if (updateError) {
    console.error('sso update error:', updateError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

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

  return NextResponse.json({ success: true });
}
