import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { isSafeOutboundUrl } from '@elogbook/shared/security/outbound-url';
import { configuredOutboundHosts } from '@/lib/outbound-request';
import { z } from 'zod';
import { projectSsoConfig } from '@/lib/sso-config';
import { logger } from '@/lib/logger';

const ALLOWED_PROTOCOLS = ['saml', 'oidc'] as const;
const ALLOWED_ROLES = ['resident', 'supervisor', 'director', 'institution_admin'] as const;

const ssoCreateSchema = z.object({
  protocol: z.enum(ALLOWED_PROTOCOLS),
  metadata_url: z.string().url().max(2048).nullable().optional(),
  discovery_url: z.string().url().max(2048).nullable().optional(),
  idp_entity_id: z.string().max(500).nullable().optional(),
  idp_certificate: z.string().max(100_000).nullable().optional(),
  client_id: z.string().max(500).nullable().optional(),
  client_secret: z.string().max(4096).nullable().optional(),
  default_role: z.enum(ALLOWED_ROLES).optional(),
  is_active: z.boolean().optional(),
}).strict();

const ssoUpdateSchema = ssoCreateSchema.partial().extend({ id: z.string().min(1).max(128) }).strict();

function isApprovedSsoUrl(value: string | null | undefined): boolean {
  return !value || isSafeOutboundUrl(value, {
    allowedHosts: configuredOutboundHosts(),
    allowHttp: process.env.NODE_ENV !== 'production',
  });
}

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
    .from('tenant_sso_configs_safe')
    .select('id, protocol, metadata_url, discovery_url, idp_entity_id, client_id, default_role, is_active, has_client_secret, has_idp_certificate, created_at, updated_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to list SSO configs', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ configs: (configs ?? []).map(projectSsoConfig) });
}

// ---------------------------------------------------------------------------
// POST — create a new SSO config
// ---------------------------------------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, ssoCreateSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 64 * 1024,
  });
  if (!guarded.ok) return guarded.response;

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
  } = guarded.data;

  if (!isApprovedSsoUrl(metadata_url) || !isApprovedSsoUrl(discovery_url)) {
    return NextResponse.json({ error: 'SSO endpoint is not approved' }, { status: 400 });
  }

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

  const { data: stored, error: storeError } = await adminClient.rpc('store_tenant_sso_config', {
    p_tenant_id: profile.tenant_id,
    p_config_id: null,
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

  if (storeError) {
    if (storeError.code === '23505') {
      return NextResponse.json({
        error: `A ${protocol} configuration already exists for this institution. Edit it instead.`,
      }, { status: 409 });
    }
    logger.error('Failed to create SSO config', storeError);
    return NextResponse.json({ error: storeError.message === 'encryption_unavailable' ? 'SSO encryption is not configured' : 'Internal server error' }, { status: storeError.message === 'encryption_unavailable' ? 503 : 500 });
  }

  const storedRecord = stored as { success?: boolean; id?: string; error?: string } | null;
  if (!storedRecord?.success || !storedRecord.id) {
    return NextResponse.json({ error: storedRecord?.error === 'encryption_unavailable' ? 'SSO encryption is not configured' : 'Internal server error' }, { status: storedRecord?.error === 'encryption_unavailable' ? 503 : 500 });
  }

  const auditResult = await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'sso_config_create', resource_type: 'tenant_sso_configs', resource_id: storedRecord.id, changes: {} });
  if (auditResult.error) {
    logger.error('Failed to audit SSO config creation', auditResult.error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({
    config: projectSsoConfig({
      id: storedRecord.id,
      protocol,
      metadata_url,
      discovery_url,
      idp_entity_id,
      client_id,
      default_role: default_role ?? 'resident',
      is_active: is_active ?? true,
      has_client_secret: client_secret != null,
      has_idp_certificate: idp_certificate != null,
    }),
  }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PUT — update an existing SSO config
// ---------------------------------------------------------------------------
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, ssoUpdateSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 64 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

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
  } = guarded.data;

  if (!isApprovedSsoUrl(metadata_url) || !isApprovedSsoUrl(discovery_url)) {
    return NextResponse.json({ error: 'SSO endpoint is not approved' }, { status: 400 });
  }

  if (!id) {
    return NextResponse.json({ error: 'Config ID is required' }, { status: 400 });
  }
  if ([protocol, metadata_url, discovery_url, idp_entity_id, idp_certificate, client_id, client_secret, default_role, is_active].every((value) => value === undefined)) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  const { data: existing, error: existingError } = await adminClient
    .from('tenant_sso_configs')
    .select('id, protocol')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();
  if (existingError) {
    logger.error('Failed to load SSO config', existingError);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

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

  const { data: stored, error: storeError } = await adminClient.rpc('store_tenant_sso_config', {
    p_tenant_id: profile.tenant_id,
    p_config_id: id,
    p_protocol: protocol ?? null,
    p_metadata_url: metadata_url ?? null,
    p_discovery_url: discovery_url ?? null,
    p_idp_entity_id: idp_entity_id ?? null,
    p_idp_certificate: idp_certificate ?? null,
    p_client_id: client_id ?? null,
    p_client_secret: client_secret ?? null,
    p_default_role: default_role ?? null,
    p_is_active: is_active ?? null,
  });

  if (storeError) {
    logger.error('Failed to update SSO config', storeError);
    return NextResponse.json({ error: storeError.message === 'encryption_unavailable' ? 'SSO encryption is not configured' : 'Internal server error' }, { status: storeError.message === 'encryption_unavailable' ? 503 : 500 });
  }

  const storedRecord = stored as { success?: boolean; id?: string; error?: string } | null;
  if (!storedRecord?.success || storedRecord.id !== id) {
    return NextResponse.json({ error: storedRecord?.error === 'encryption_unavailable' ? 'SSO encryption is not configured' : 'Internal server error' }, { status: storedRecord?.error === 'encryption_unavailable' ? 503 : 500 });
  }

  const auditResult = await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'sso_config_update', resource_type: 'tenant_sso_configs', resource_id: id, changes: {} });
  if (auditResult.error) {
    logger.error('Failed to audit SSO config update', auditResult.error);
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
  const guarded = await guardRequest(request, undefined, {
    trustedOrigins: defaultTrustedOrigins(request),
    requireBody: false,
  });
  if (!guarded.ok) return guarded.response;

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
  const { data: existing, error: existingError } = await adminClient
    .from('tenant_sso_configs')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();
  if (existingError) {
    logger.error('Failed to load SSO config for deletion', existingError);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: 'SSO config not found' }, { status: 404 });
  }

  const { error: deleteError } = await adminClient
    .from('tenant_sso_configs')
    .delete()
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id);

  if (deleteError) {
    logger.error('Failed to delete SSO config', deleteError);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
