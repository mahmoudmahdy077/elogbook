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