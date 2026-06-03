import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { redirect } from 'next/navigation';
import SubscriptionPlans from '@/components/SubscriptionPlans';

export default async function BillingPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, user_id, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenant = profile.tenants as unknown as { slug: string; tenant_type: string };
  if (tenant.slug !== params.tenant) redirect('/login');

  const { data: plans } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('tenant_type', tenant.tenant_type)
    .order('price_monthly', { ascending: true });

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*, plan:subscription_plans(*)')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();

  const { data: gatewayConfig } = await supabase
    .from('payment_gateway_config')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .eq('is_active', true)
    .maybeSingle();

  const { data: purchases } = await supabase
    .from('one_time_purchases')
    .select('*')
    .eq('resident_id', profile.id)
    .eq('purchase_type', 'ai_report')
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Billing & Subscription</h1>

      {subscription && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Current Plan</h2>
          </CardHeader>
          <CardBody>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-bold">
                  {(subscription.plan as any)?.name ?? 'Unknown Plan'}
                </p>
                <p className="text-default-500">
                  ${Number((subscription.plan as any)?.price_monthly ?? 0).toFixed(2)}/month
                </p>
              </div>
              <div className="text-right">
                <Chip color="success" variant="flat" size="sm">Active</Chip>
                {subscription.current_period_end && (
                  <p className="text-sm text-default-500 mt-1">
                    Next billing: {new Date(subscription.current_period_end).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <SubscriptionPlans
        plans={plans ?? []}
        tenantId={profile.tenant_id}
        gatewayProvider={gatewayConfig?.provider ?? null}
        publishableKey={gatewayConfig?.publishable_key ?? null}
        currentPlanId={subscription?.plan_id ?? null}
      />

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">AI Report Credits</h2>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-default-500 mb-4">
            Generate comprehensive AI analysis reports for your cases. One-time purchase of $4.99 per report.
          </p>

          {(!purchases || purchases.length === 0) ? (
            <p className="text-sm text-default-400">No AI report purchases yet.</p>
          ) : (
            <div className="space-y-2">
              {purchases.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-divider pb-2">
                  <div>
                    <p className="text-sm font-medium">${Number(p.amount).toFixed(2)}</p>
                    <p className="text-xs text-default-400">
                      {new Date(p.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Chip
                    color={p.status === 'completed' ? 'success' : 'warning'}
                    variant="flat"
                    size="sm"
                  >
                    {p.status === 'completed' ? 'Delivered' : 'Pending'}
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
