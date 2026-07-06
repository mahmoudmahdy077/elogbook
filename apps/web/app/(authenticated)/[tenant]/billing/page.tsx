import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ClientSubscriptionPlans from '@/components/ClientSubscriptionPlans';
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

  const { data: plans, error: plansError } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('tenant_type', auth.tenant.tenant_type)
    .order('price_monthly', { ascending: true });
  if (plansError) return <ErrorDisplay message={plansError.message} />;

  const { data: subscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('*, plan:subscription_plans(*)')
    .eq('tenant_id', auth.profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();
  if (subscriptionError) return <ErrorDisplay message={subscriptionError.message} />;

  const { data: gatewayConfig, error: gatewayError } = await supabase
    .from('payment_gateway_config')
    .select('*')
    .eq('tenant_id', auth.profile.tenant_id)
    .eq('is_active', true)
    .maybeSingle();
  if (gatewayError) return <ErrorDisplay message={gatewayError.message} />;

  const { data: purchases, error: purchasesError } = await supabase
    .from('one_time_purchases')
    .select('*')
    .eq('resident_id', auth.profile.id)
    .eq('purchase_type', 'ai_report')
    .order('created_at', { ascending: false });
  if (purchasesError) return <ErrorDisplay message={purchasesError.message} />;

  const { count: caseCount, error: caseCountError } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', auth.profile.tenant_id)
    .is('deleted_at', null);
  if (caseCountError) return <ErrorDisplay message={caseCountError.message} />;

  const { count: residentCount, error: residentCountError } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', auth.profile.tenant_id);
  if (residentCountError) return <ErrorDisplay message={residentCountError.message} />;

  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('*')
    .eq('tenant_id', auth.profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(10);
  if (paymentsError) return <ErrorDisplay message={paymentsError.message} />;

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
          <h2 className="text-lg font-semibold mb-3">Current Plan</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xl font-bold">
                {plan?.name ?? 'Unknown Plan'}
              </p>
              <p className="text-sm text-[#8E8E93]">
                ${Number(plan?.price_monthly ?? 0).toFixed(2)}/month
              </p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Active
              </span>
              {subscription.current_period_end && (
                <p className="text-sm text-[#8E8E93] mt-1 clinical-data">
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
            <p className="text-sm text-[#8E8E93]">Cases Logged</p>
            <p className="text-2xl font-bold">{caseCount ?? 0}</p>
          </div>
          <div>
            <p className="text-sm text-[#8E8E93]">Team Members</p>
            <p className="text-2xl font-bold">{residentCount ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-black/5 dark:border-white/10 p-5">
        <h2 className="text-lg font-semibold mb-3">Payment History</h2>
        {!payments || payments.length === 0 ? (
          <p className="text-sm text-[#8E8E93]">No payments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p: { id: string; amount: number; status: string; created_at: string }) => (
              <div key={p.id} className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-2">
                <div>
                  <p className="text-sm font-medium">${Number(p.amount).toFixed(2)}</p>
                  <p className="text-xs text-[#8E8E93] clinical-data">
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
        <p className="text-sm text-[#8E8E93] mb-4">
          Generate comprehensive AI analysis reports for your cases. One-time purchase of $4.99 per report.
        </p>

        {(!purchases || purchases.length === 0) ? (
          <p className="text-sm text-[#8E8E93]">No AI report purchases yet.</p>
        ) : (
          <div className="space-y-2">
            {purchases.map((p: { id: string; purchase_type: string; amount: number; created_at: string; status: string }) => (
              <div key={p.id} className="flex items-center justify-between border-b border-black/5 dark:border-white/10 pb-2">
                <div>
                  <p className="text-sm font-medium">${Number(p.amount).toFixed(2)}</p>
                  <p className="text-xs text-[#8E8E93] clinical-data">
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
