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
import { logger } from '@/lib/logger';

const paymentGatewaySchema = z.object({
  provider: z.string().min(1).max(64),
  publishable_key: z.string().min(1).max(512),
  is_active: z.boolean().optional(),
  endpoint_url: z.string().url().max(2048).nullable().optional(),
  secret_key: z.string().max(2048).optional(),
  webhook_secret: z.string().max(2048).optional(),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const guarded = await guardRequest(request, paymentGatewaySchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 16 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  // Rate limit needs user identity — fetch user once and reuse via guard
  const { data: { user: _preUser } } = await supabase.auth.getUser();
  if (!_preUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { allowed, retryAfter } = await checkRateLimit(`payment-gateway:${_preUser.id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  const { provider, publishable_key, is_active, endpoint_url, secret_key, webhook_secret } = guarded.data;

  if (endpoint_url && !isSafeOutboundUrl(endpoint_url, {
    allowedHosts: configuredOutboundHosts(),
    allowHttp: process.env.NODE_ENV !== 'production',
  })) {
    return NextResponse.json({ error: 'Payment endpoint is not approved' }, { status: 400 });
  }

  const { data: result, error } = await supabase.rpc('store_payment_gateway_secret', {
    p_provider: provider,
    p_publishable_key: publishable_key,
    p_secret_key: secret_key || '',
    p_webhook_secret: webhook_secret || '',
    p_endpoint_url: endpoint_url || null,
    p_mode: (is_active ? 'live' : 'test'),
  });

  if (error) {
    logger.error('Failed to store payment gateway config', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (result?.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'payment_gateway_upsert', resource_type: 'payment_gateway_config', resource_id: result.id, changes: {} });

  return NextResponse.json({ success: true, config: { id: result.id } });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  return POST(request, { params });
}