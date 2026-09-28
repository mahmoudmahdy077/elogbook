'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Plan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: string;
  max_residents: number | null;
  is_custom: boolean;
  custom_features: { feature_key: string; feature_value: unknown }[];
}

interface Subscription {
  id: string;
  plan_id: string;
  status: string;
  current_period_end: string | null;
  plan: Plan;
}

interface SubscriptionManagerProps {
  tenantSlug: string;
}

// Read-only by design.
//
// This panel used to POST a plan change, POST a cancellation, and POST/PUT a new
// catalog row. None of those are entitlement operations a tenant may perform:
// the plan catalog is platform-owned, and entitlement state is written only by a
// verified Stripe event. Activation is checkout, cancellation is the billing
// portal, and both live on the billing page.
export default function SubscriptionManager({ tenantSlug }: SubscriptionManagerProps) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<{ id: string; amount: number; currency: string; status: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/subscription`);
      if (!res.ok) {
        // API returned error, silently ignore (Supabase may not be running)
        return;
      }
      const contentType = res.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        // Response is not JSON (e.g., HTML error page)
        return;
      }
      const data = await res.json();
      setSubscription(data.subscription);
      setPlans(data.plans ?? []);
      setPayments(data.payments ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="p-4 text-text-muted">Loading subscription...</div>;

  return (
    <div className="space-y-6">
      {/* Current Subscription */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-2">Current Subscription</h3>
        {subscription ? (
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">{subscription.plan?.name ?? 'Unknown'}</span>
              <span className="ml-2 text-text-muted">${subscription.plan?.price_monthly ?? 0}/mo</span>
              <span className={`ml-2 text-xs px-2 py-0.5 rounded ${subscription.status === 'active' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                {subscription.status}
              </span>
            </div>
            <Link
              href={`/${tenantSlug}/billing`}
              className="px-3 py-1 rounded border border-border text-xs hover:bg-surface-elevated"
            >
              Manage subscription
            </Link>
          </div>
        ) : (
          <p className="text-text-muted text-sm">No active subscription</p>
        )}
      </div>

      {/* Available Plans (read-only catalog) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Available Plans</h3>
          <Link
            href={`/${tenantSlug}/billing`}
            className="px-3 py-1 rounded border border-border text-xs hover:bg-surface-elevated"
          >
            Subscribe
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {plans.map(plan => (
            <div key={plan.id} className={`panel p-4 ${subscription?.plan_id === plan.id ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{plan.name}</span>
                {plan.is_custom && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Custom</span>}
              </div>
              <div className="text-2xl font-bold mb-2">${plan.price_monthly}<span className="text-sm font-normal text-text-muted">/mo</span></div>
              <div className="text-xs text-text-muted">
                {plan.tenant_type} · {plan.max_residents ? `${plan.max_residents} residents` : 'Unlimited'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Payment History */}
      <div>
        <h3 className="font-semibold mb-3">Payment History</h3>
        {payments.length === 0 ? (
          <p className="text-text-muted text-sm">No payments yet</p>
        ) : (
          <div className="space-y-2">
            {payments.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <span className="font-mono text-sm">${p.amount}</span>
                  <span className="ml-2 text-xs text-text-muted">{new Date(p.created_at).toLocaleDateString()}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${p.status === 'completed' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
