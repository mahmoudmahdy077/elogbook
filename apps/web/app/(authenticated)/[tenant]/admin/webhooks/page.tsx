import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import WebhookManager from '@/components/WebhookManager';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function AdminWebhooksPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenant = profile.tenants as { slug: string };
  if (!tenant || tenant.slug !== tenantSlug) redirect('/login');

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    redirect('/login');
  }

  // Fetch webhooks using service role (bypass RLS to read all)
  const adminClient = createServiceRoleClient();
  const { data: webhooks, error: webhooksError } = await adminClient
    .from('tenant_webhooks')
    .select('id, url, events, is_active, description, created_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (webhooksError) {
    return <ErrorDisplay message={webhooksError.message} />;
  }

  // Fetch latest delivery status per webhook
  const webhookIds = (webhooks ?? []).map((w) => w.id);
  const deliveryMap = new Map<string, { last_sent: string | null; last_status: number | null; last_succeeded: boolean | null }>();

  if (webhookIds.length > 0) {
    const { data: deliveries } = await adminClient
      .from('tenant_webhook_deliveries')
      .select('webhook_id, attempted_at, status_code, succeeded')
      .in('webhook_id', webhookIds)
      .order('attempted_at', { ascending: false })
      .limit(webhookIds.length);

    for (const d of deliveries ?? []) {
      if (!deliveryMap.has(d.webhook_id)) {
        deliveryMap.set(d.webhook_id, {
          last_sent: d.attempted_at,
          last_status: d.status_code,
          last_succeeded: d.succeeded,
        });
      }
    }
  }

  const webhooksWithDelivery = (webhooks ?? []).map((w) => ({
    ...w,
    last_sent: deliveryMap.get(w.id)?.last_sent ?? null,
    last_status: deliveryMap.get(w.id)?.last_status ?? null,
    last_succeeded: deliveryMap.get(w.id)?.last_succeeded ?? null,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Webhook Configuration</h1>
        <Link
          href={`/${tenantSlug}/admin`}
          className="text-sm text-primary hover:underline"
        >
          ← Back to Admin
        </Link>
      </div>
      <WebhookManager tenantId={profile.tenant_id} initialWebhooks={webhooksWithDelivery} />
    </div>
  );
}
