import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
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

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('subscription_plans!inner(features)')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();
  const features = (sub as any)?.subscription_plans?.features as Record<string, unknown> | null;
  if (!features?.ai_config) {
    return NextResponse.json({ error: 'Not available on your plan' }, { status: 503 });
  }

  const body = await request.json();
  const { provider, model, is_active, endpoint_url, api_key } = body;

  if (!model) {
    return NextResponse.json({ error: 'Model is required.' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();

  const payload: Record<string, unknown> = {
    tenant_id: profile.tenant_id,
    provider,
    model,
    is_active: is_active ?? false,
  };

  if (api_key) {
    payload.encrypted_api_key = api_key;
  }
  if (endpoint_url !== undefined) {
    payload.endpoint_url = endpoint_url;
  }

  const { data: existing } = await adminClient
    .from('ai_config')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  let configId: string | undefined;

  if (existing) {
    const updatePayload = { ...payload };
    delete updatePayload.tenant_id;

    const { error } = await adminClient
      .from('ai_config')
      .update(updatePayload)
      .eq('id', existing.id);

    if (error) {
      console.error('ai-config error:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    configId = existing.id;
  } else {
    if (!api_key) {
      return NextResponse.json({ error: 'API Key is required for new configuration.' }, { status: 400 });
    }

    const { data: newConfig, error } = await adminClient
      .from('ai_config')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      console.error('ai-config error:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    configId = newConfig!.id;
  }

  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'ai_config_upsert', resource_type: 'ai_config', resource_id: configId!, changes: {} });

  return NextResponse.json({ success: true, has_key: !!api_key || !!existing });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  return POST(request, { params });
}