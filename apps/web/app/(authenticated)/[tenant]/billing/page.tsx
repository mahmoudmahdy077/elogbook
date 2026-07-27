import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ClientSubscriptionPlans from '@/components/ClientSubscriptionPlans';
import ManageSubscriptionButton from '@/components/ManageSubscriptionButton';
import ErrorDisplay from '@/components/ErrorDisplay';

interface SubscriptionPlan {
  name: string;
  price_monthly: number;
}

export default async function BillingPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();

  const [plansResult, subscriptionResult, gatewayResult, purchasesResult, caseCountResult, residentCountResult, paymentsResult] = await Promise.all([
    supabase
      .from('subscription_plans')
      .select('name, price_monthly')
      .eq('tenant_type', auth.tenant.tenant_type)
      .order('price_monthly', { ascending: true }),
    supabase
      .from('subscriptions')
      .select('id, plan_id, tenant_id, status, current_period_end, plan:subscription_plans(name, price_monthly)')
      .eq('tenant_id', auth.profile.tenant_id)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('payment_gateway_config')
      .select('provider, publishable_key')
      .eq('tenant_id', auth.profile.tenant_id)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('one_time_purchases')
      .select('id, purchase_type, amount, created_at, status')
      .eq('resident_id', auth.profile.id)
      .eq('purchase_type', 'ai_report')
      .order('created_at', { ascending: false }),
    supabase
      .from('case_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.profile.tenant_id)
      .is('deleted_at', null),
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.profile.tenant_id),
    supabase
      .from('payments')
      .select('id, amount, status, created_at')
      .eq('tenant_id', auth.profile.tenant_id)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const error = plansResult.error || subscriptionResult.error || gatewayResult.error || purchasesResult.error || caseCountResult.error || residentCountResult.error || paymentsResult.error;
  if (error) return <ErrorDisplay message={error.message} />;

  const plans = plansResult.data;
  const subscription = subscriptionResult.data;
  const gatewayConfig = gatewayResult.data;
  const purchases = purchasesResult.data;
  const caseCount = caseCountResult.count;
  const residentCount = residentCountResult.count;
  const payments = paymentsResult.data;

  const plan = (subscription as Record<string, unknown> | null)?.plan as SubscriptionPlan | null;

  function StatusBadge({ status }: { status: string }) {
    const isSuccess = status === 'completed' || status === 'succeeded';
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          isSuccess
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}
      >
        {isSuccess ? 'Paid' : status}
      </span>
    );
  }

  function PurchaseBadge({ status }: { status: string }) {
    const isDelivered = status === 'completed';
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          isDelivered
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}
      >
        {isDelivered ? 'Delivered' : 'Pending'}
      </span>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Billing &amp; Subscription</h1>

      {subscription && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-black/5 dark:border-white/10 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Current Plan</h2>
            <ManageSubscriptionButton />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xl font-bold">
                {plan?.name ?? 'Unknown Plan'}
              </p>
              <p className="text-sm text-text-muted">
                ${Number(plan?.price_monthly ?? 0).toFixed(2)}/month
              </p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Active
              </span>
              {subscription.current_period_end && (
                <p className="text-sm text-text-muted mt-1 clinical-data">
                  Next billing: {new Date(subscription.current_period_end).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-black/5 dark:border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-3">Usage This Period</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-text-muted">Cases Logged</p>
            <p className="text-2xl font-bold">{caseCount ?? 0}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">Team Members</p>
            <p className="text-2xl font-bold">{residentCount ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-black/5 dark:border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-3">Payment History</h2>
        {!payments || payments.length === 0 ? (
          <p className="text-sm text-text-muted">No payments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p: { id: string; amount: number; status: string; created_at: string }) => (
              <div key={p.id} className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-2">
                <div>
                  <p className="text-sm font-medium">${Number(p.amount).toFixed(2)}</p>
                  <p className="text-xs text-text-muted clinical-data">
                    {new Date(p.created_at).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <ClientSubscriptionPlans
        plans={plans ?? []}
        tenantId={auth.profile.tenant_id}
        gatewayProvider={gatewayConfig?.provider ?? null}
        publishableKey={gatewayConfig?.publishable_key ?? null}
        currentPlanId={subscription?.plan_id ?? null}
      />

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-black/5 dark:border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-3">AI Report Credits</h2>
        <p className="text-sm text-text-muted mb-4">
          Generate comprehensive AI analysis reports for your cases. One-time purchase of $4.99 per report.
        </p>

        {(!purchases || purchases.length === 0) ? (
          <p className="text-sm text-text-muted">No AI report purchases yet.</p>
        ) : (
          <div className="space-y-2">
            {purchases.map((p: { id: string; purchase_type: string; amount: number; created_at: string; status: string }) => (
              <div key={p.id} className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-2">
                <div>
                  <p className="text-sm font-medium">${Number(p.amount).toFixed(2)}</p>
                  <p className="text-xs text-text-muted clinical-data">
                    {new Date(p.created_at).toLocaleDateString()}
                  </p>
                </div>
                <PurchaseBadge status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
