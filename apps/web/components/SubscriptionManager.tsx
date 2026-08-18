'use client';

import { useState, useEffect, useCallback } from 'react';

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

export default function SubscriptionManager({ tenantSlug }: SubscriptionManagerProps) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<{ id: string; amount: number; currency: string; status: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/subscription`);
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

  const handleChangePlan = useCallback(async (planId: string) => {
    if (!confirm('Change subscription plan?')) return;
    setChanging(true);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/subscription`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed');
        return;
      }
      loadData();
    } finally {
      setChanging(false);
    }
  }, [tenantSlug, loadData]);

  const handleCancel = useCallback(async () => {
    if (!confirm('Cancel subscription? This can be reverted by selecting a new plan.')) return;
    const reason = prompt('Reason for cancellation (optional):');
    setChanging(true);
    try {
      const res = await fetch(`/api/${tenantSlug}/admin/subscription/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed');
        return;
      }
      loadData();
    } finally {
      setChanging(false);
    }
  }, [tenantSlug, loadData]);

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
            <div className="flex gap-2">
              {subscription.status === 'active' && (
                <button onClick={handleCancel} disabled={changing} className="px-3 py-1 rounded border border-danger/30 text-danger text-xs hover:bg-danger/10">
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-text-muted text-sm">No active subscription</p>
        )}
      </div>

      {/* Available Plans */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Available Plans</h3>
          <button onClick={() => setShowCreatePlan(true)} className="px-3 py-1 rounded bg-primary text-white text-xs">
            Create Plan
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {plans.map(plan => (
            <div key={plan.id} className={`panel p-4 ${subscription?.plan_id === plan.id ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{plan.name}</span>
                {plan.is_custom && <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Custom</span>}
              </div>
              <div className="text-2xl font-bold mb-2">${plan.price_monthly}<span className="text-sm font-normal text-text-muted">/mo</span></div>
              <div className="text-xs text-text-muted mb-3">
                {plan.tenant_type} · {plan.max_residents ? `${plan.max_residents} residents` : 'Unlimited'}
              </div>
              <div className="flex gap-2">
                {subscription?.plan_id !== plan.id && (
                  <button onClick={() => handleChangePlan(plan.id)} disabled={changing} className="flex-1 px-3 py-1.5 rounded bg-primary text-white text-xs">
                    {changing ? 'Switching...' : 'Select'}
                  </button>
                )}
                {plan.is_custom && (
                  <button onClick={() => setEditingPlan(plan)} className="px-3 py-1.5 rounded border border-border text-xs">
                    Edit
                  </button>
                )}
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

      {/* Create/Edit Plan Modal */}
      {(showCreatePlan || editingPlan) && (
        <PlanEditorModal
          plan={editingPlan}
          tenantSlug={tenantSlug}
          onClose={() => { setShowCreatePlan(false); setEditingPlan(null); }}
          onSave={() => { setShowCreatePlan(false); setEditingPlan(null); loadData(); }}
        />
      )}
    </div>
  );
}

function PlanEditorModal({ plan, tenantSlug, onClose, onSave }: { plan: Plan | null; tenantSlug: string; onClose: () => void; onSave: () => void }) {
  const [name, setName] = useState(plan?.name ?? '');
  const [slug, setSlug] = useState(plan?.slug ?? '');
  const [price, setPrice] = useState(plan?.price_monthly?.toString() ?? '0');
  const [tenantType, setTenantType] = useState(plan?.tenant_type ?? 'individual');
  const [maxResidents, setMaxResidents] = useState(plan?.max_residents?.toString() ?? '');
  const [features, setFeatures] = useState(JSON.stringify(plan?.features ?? {}, null, 2));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        slug,
        price_monthly: parseFloat(price) || 0,
        tenant_type: tenantType,
        max_residents: maxResidents ? parseInt(maxResidents) : null,
        features: JSON.parse(features),
      };
      if (plan) body.id = plan.id;

      const res = await fetch(`/api/${tenantSlug}/admin/plans`, {
        method: plan ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed');
        return;
      }
      onSave();
    } catch {
      alert('Invalid features JSON');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="glass-panel p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{plan ? 'Edit Plan' : 'Create Plan'}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1 text-text-muted">Plan Name</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" />
            </div>
            <div>
              <label className="block text-xs mb-1 text-text-muted">Slug</label>
              <input value={slug} onChange={e => setSlug(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs mb-1 text-text-muted">Price ($/mo)</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" />
            </div>
            <div>
              <label className="block text-xs mb-1 text-text-muted">Type</label>
              <select value={tenantType} onChange={e => setTenantType(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm">
                <option value="individual">Individual</option>
                <option value="institution">Institution</option>
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1 text-text-muted">Max Residents</label>
              <input type="number" value={maxResidents} onChange={e => setMaxResidents(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" placeholder="Unlimited" />
            </div>
          </div>
          <div>
            <label className="block text-xs mb-1 text-text-muted">Features (JSON)</label>
            <textarea value={features} onChange={e => setFeatures(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm font-mono" rows={6} />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-white text-sm disabled:opacity-50">
            {saving ? 'Saving...' : plan ? 'Update Plan' : 'Create Plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
