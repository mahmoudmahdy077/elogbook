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

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { allowed, retryAfter } = await checkRateLimit(`payment-gateway:${user.id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

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

  const body = await request.json();
  const { provider, publishable_key, is_active, endpoint_url, secret_key, webhook_secret } = body;

  if (!publishable_key) {
    return NextResponse.json({ error: 'Publishable key is required.' }, { status: 400 });
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
    console.error('payment-gateway rpc error:', error.message);
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
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  return POST(request, { params });
}