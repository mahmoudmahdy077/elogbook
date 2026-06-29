import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, Chip } from '@heroui/react';
import { redirect } from 'next/navigation';
import SubscriptionPlans from '@/components/SubscriptionPlans';

interface SubscriptionPlan {
  name: string;
  price_monthly: number;
}

export default async function BillingPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();

  const { data: plans } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('tenant_type', auth.tenant.tenant_type)
    .order('price_monthly', { ascending: true });

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*, plan:subscription_plans(*)')
    .eq('tenant_id', auth.profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();

  const { data: gatewayConfig } = await supabase
    .from('payment_gateway_config')
    .select('*')
    .eq('tenant_id', auth.profile.tenant_id)
    .eq('is_active', true)
    .maybeSingle();

  const { data: purchases } = await supabase
    .from('one_time_purchases')
    .select('*')
    .eq('resident_id', auth.profile.id)
    .eq('purchase_type', 'ai_report')
    .order('created_at', { ascending: false });

  const plan = (subscription as Record<string, unknown> | null)?.plan as SubscriptionPlan | null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Billing & Subscription</h1>

      {subscription && (
        <Card className="panel">
          <Card.Header>
            <h2 className="text-lg font-semibold">Current Plan</h2>
          </Card.Header>
          <Card.Content>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-bold">
                  {plan?.name ?? 'Unknown Plan'}
                </p>
                <p className="text-default-500">
                  ${Number(plan?.price_monthly ?? 0).toFixed(2)}/month
                </p>
              </div>
              <div className="text-right">
                <Chip color="success" variant="soft" size="sm">Active</Chip>
                {subscription.current_period_end && (
                  <p className="text-sm text-default-500 mt-1 clinical-data">
                    Next billing: {new Date(subscription.current_period_end).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          </Card.Content>
        </Card>
      )}

      <SubscriptionPlans
        plans={plans ?? []}
        tenantId={auth.profile.tenant_id}
        gatewayProvider={gatewayConfig?.provider ?? null}
        publishableKey={gatewayConfig?.publishable_key ?? null}
        currentPlanId={subscription?.plan_id ?? null}
      />

      <Card className="panel">
        <Card.Header>
          <h2 className="text-lg font-semibold">AI Report Credits</h2>
        </Card.Header>
        <Card.Content>
          <p className="text-sm text-default-500 mb-4">
            Generate comprehensive AI analysis reports for your cases. One-time purchase of $4.99 per report.
          </p>

          {(!purchases || purchases.length === 0) ? (
            <p className="text-sm text-default-400">No AI report purchases yet.</p>
          ) : (
            <div className="space-y-2">
              {purchases.map((p: { id: string; purchase_type: string; amount: number; created_at: string; status: string }) => (
                <div key={p.id} className="flex items-center justify-between border-b border-divider pb-2">
                  <div>
                    <p className="text-sm font-medium">${Number(p.amount).toFixed(2)}</p>
                    <p className="text-xs text-default-400 clinical-data">
                      {new Date(p.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Chip
                    color={p.status === 'completed' ? 'success' : 'warning'}
                    variant="soft"
                    size="sm"
                  >
                    {p.status === 'completed' ? 'Delivered' : 'Pending'}
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
