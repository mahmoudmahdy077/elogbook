import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { testWebhookEndpoint } from '@/lib/webhooks';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';

const webhookTestSchema = z.object({
  webhook_id: z.string().min(1).max(128),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, webhookTestSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 8 * 1024,
  });
  if (!guarded.ok) return guarded.response;

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

  const { webhook_id } = guarded.data;

  const adminClient = createServiceRoleClient();
  const { data: wh, error: whError } = await adminClient
    .from('tenant_webhooks')
    .select('url')
    .eq('id', webhook_id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (whError || !wh) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }

  const { data: webhookSecret, error: secretError } = await adminClient.rpc(
    'get_tenant_webhook_secret',
    { p_webhook_id: webhook_id },
  );
  if (secretError || !webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret is unavailable' }, { status: 503 });
  }

  const result = await testWebhookEndpoint(wh.url, webhookSecret, profile.tenant_id);

  return NextResponse.json(result);
}
