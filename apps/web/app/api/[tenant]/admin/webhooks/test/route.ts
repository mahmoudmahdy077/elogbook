import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { testWebhookEndpoint } from '@/lib/webhooks';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const { data: { user: _preUser } } = await supabase.auth.getUser();
  if (!_preUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { allowed, retryAfter } = await checkRateLimit(`webhook-test:${_preUser.id}`, 5);
  if (!allowed) return rateLimitResponse(retryAfter);

  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;

  let body: { webhook_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { webhook_id } = body;
  if (!webhook_id) {
    return NextResponse.json({ error: 'webhook_id is required' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  const { data: wh, error: whError } = await adminClient
    .from('tenant_webhooks')
    .select('url, secret')
    .eq('id', webhook_id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (whError || !wh) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }

  const result = await testWebhookEndpoint(wh.url, wh.secret, profile.tenant_id);

  return NextResponse.json(result);
}
