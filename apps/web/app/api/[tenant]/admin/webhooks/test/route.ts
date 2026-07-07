import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { testWebhookEndpoint } from '@/lib/webhooks';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

export async function POST(
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

  const { allowed, retryAfter } = checkRateLimit(`webhook-test:${user.id}`, 5);
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
