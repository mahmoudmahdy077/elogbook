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

const aiConfigSchema = z.object({
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(200),
  is_active: z.boolean().optional(),
  endpoint_url: z.string().url().max(2048).nullable().optional(),
  api_key: z.string().max(4096).optional(),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const guarded = await guardRequest(request, aiConfigSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 16 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`ai-config:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('subscription_plans!inner(features)')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();
  const features = (sub as { subscription_plans?: { features?: Record<string, unknown> } | null })?.subscription_plans?.features ?? null;
  if (!features?.ai_config) {
    return NextResponse.json({ error: 'Not available on your plan' }, { status: 503 });
  }

  const { provider, model, is_active, endpoint_url, api_key } = guarded.data;

  if (endpoint_url && !isSafeOutboundUrl(endpoint_url, {
    allowedHosts: configuredOutboundHosts(),
    allowHttp: process.env.NODE_ENV !== 'production',
  })) {
    return NextResponse.json({ error: 'AI endpoint is not approved' }, { status: 400 });
  }

  const { data: result, error } = await supabase.rpc('store_ai_config', {
    p_provider: provider,
    p_model: model,
    p_api_key: api_key || '',
    p_endpoint_url: endpoint_url || null,
    p_is_active: is_active ?? false,
  });

  if (error) {
    logger.error('Failed to store AI config', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (result?.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'ai_config_upsert', resource_type: 'ai_config', resource_id: result.id, changes: {} });

  return NextResponse.json({ success: true, config: { id: result.id } });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  return POST(request, { params });
}