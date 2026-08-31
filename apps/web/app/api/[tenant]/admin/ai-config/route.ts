import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

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

  const body = await request.json();
  const { provider, model, is_active, endpoint_url, api_key } = body;

  if (!model) {
    return NextResponse.json({ error: 'Model is required.' }, { status: 400 });
  }

  const { data: result, error } = await supabase.rpc('store_ai_config', {
    p_provider: provider,
    p_model: model,
    p_api_key: api_key || '',
    p_endpoint_url: endpoint_url || null,
    p_is_active: is_active ?? false,
  });

  if (error) {
    console.error('ai-config rpc error:', error.message);
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
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  return POST(request, { params });
}