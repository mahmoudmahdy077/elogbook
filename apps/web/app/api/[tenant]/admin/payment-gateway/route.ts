import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { allowed, retryAfter } = checkRateLimit(`payment-gateway:${user.id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = (profile.tenants as { slug: string }[])[0];
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json();
  const { provider, publishable_key, is_active, endpoint_url, secret_key, webhook_secret } = body;

  if (!publishable_key) {
    return NextResponse.json({ error: 'Publishable key is required.' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();

  const payload: Record<string, unknown> = {
    tenant_id: profile.tenant_id,
    provider,
    publishable_key,
    is_active: is_active ?? false,
  };

  if (secret_key) {
    payload.encrypted_secret_key = secret_key;
  }
  if (webhook_secret) {
    payload.encrypted_webhook_secret = webhook_secret;
  }
  if (endpoint_url !== undefined) {
    payload.endpoint_url = endpoint_url;
  }

  const { data: existing } = await adminClient
    .from('payment_gateway_config')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  if (existing) {
    const updatePayload = { ...payload };
    delete updatePayload.tenant_id;

    const { error } = await adminClient
      .from('payment_gateway_config')
      .update(updatePayload)
      .eq('id', existing.id);

    if (error) {
      console.error('payment-gateway error:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  } else {
    const { error } = await adminClient
      .from('payment_gateway_config')
      .insert(payload);

    if (error) {
      console.error('payment-gateway error:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  return POST(request, { params });
}