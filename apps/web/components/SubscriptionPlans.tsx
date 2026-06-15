'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';

interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: string;
  max_residents: number | null;
}

interface Props {
  plans: SubscriptionPlan[];
  tenantId: string;
  gatewayProvider: string | null;
  publishableKey: string | null;
  currentPlanId: string | null;
}

const FEATURE_LABELS: Record<string, string> = {
  ai_insights: 'AI Insights',
  pdf_export: 'PDF Export',
  approval_workflow: 'Approval Workflow',
  goals: 'Goals & Milestones',
  audit: 'Audit Trail',
  sso: 'SSO',
  max_cases: 'Case Logging',
  priority_support: 'Priority Support',
  custom_branding: 'Custom Branding',
};

const CORE_FEATURES = ['max_cases', 'pdf_export', 'approval_workflow'];
const PREMIUM_FEATURES = ['ai_insights', 'goals', 'audit'];
const ENTERPRISE_FEATURES = ['sso', 'priority_support', 'custom_branding'];

function getFeatureGroup(features: Record<string, unknown>) {
  const all = Object.entries(FEATURE_LABELS).filter(([k]) => k in features).map(([k, label]) => ({
    key: k,
    label,
    included: !!features[k],
  }));
  if (features.max_residents) {
    all.push({ key: 'max_residents', label: `Up to ${features.max_residents} residents`, included: true });
  }
  return all;
}

const staggerDelay = 0.05;

export default function SubscriptionPlans({
  plans,
  tenantId,
  gatewayProvider,
  publishableKey,
  currentPlanId,
}: Props) {
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);

  if (!plans || plans.length === 0) {
    return (
      <div className="panel p-6 text-center">
        <p className="text-neutral-light/50">No plans available.</p>
      </div>
    );
  }

  async function handleSubscribe(planId: string) {
    setLoadingPlanId(planId);
    const supabase = createClient();
    try {
      const gateway = gatewayProvider ?? 'stripe';
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { tenant_id: tenantId, plan_id: planId, gateway },
      });
      if (error) throw error;
      if (data?.sessionId && publishableKey) {
        interface StripeWindow {
          Stripe?: {
            redirectToCheckout: (options: { sessionId: string }) => Promise<void>;
          };
        }
        const stripe = (window as StripeWindow).Stripe;
        if (stripe) {
          await stripe.redirectToCheckout({ sessionId: data.sessionId });
        } else {
          window.location.href = `https://checkout.stripe.com/pay/${data.sessionId}`;
        }
      }
    } catch (err) {
      console.error('Subscribe error:', err);
    } finally {
      setLoadingPlanId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-heading font-semibold">Subscription Plans</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {plans.map((plan, index) => {
          const isCurrent = plan.id === currentPlanId;
          const features = getFeatureGroup(plan.features ?? {});
          const isFree = Number(plan.price_monthly) === 0;

          return (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * staggerDelay, ease: [0.4, 0, 0.2, 1] }}
              whileHover={{ scale: isCurrent ? 1 : 1.02 }}
              className={`panel p-5 flex flex-col ${
                isCurrent ? 'ring-2 ring-teal-400 shadow-[0_0_16px_rgba(13,148,136,0.15)]' : ''
              }`}
            >
              {isCurrent && (
                <span className="badge-approved px-2.5 py-0.5 text-xs font-semibold rounded-full self-start mb-3">
                  Current Plan
                </span>
              )}
              <h3 className="text-base font-heading font-semibold">{plan.name}</h3>
              <div className="mt-2 mb-4">
                <span className="text-3xl font-bold font-heading">
                  {isFree ? 'Free' : `$${Number(plan.price_monthly).toFixed(2)}`}
                </span>
                {!isFree && <span className="text-sm text-neutral-light/50">/mo</span>}
              </div>
              <ul className="space-y-2.5 flex-1 text-sm">
                {features.map((f) => (
                  <li key={f.key} className={`flex items-start gap-2 ${f.included ? 'text-neutral-light' : 'text-neutral-light/30 line-through'}`}>
                    <span className={`mt-0.5 shrink-0 ${f.included ? 'text-teal-400' : 'text-neutral-light/20'}`}>
                      {f.included ? '✓' : '✗'}
                    </span>
                    {f.label}
                  </li>
                ))}
              </ul>
              <button
                className={`mt-5 w-full py-2.5 rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
                  isCurrent
                    ? 'bg-teal-500/10 text-teal-400 cursor-default'
                    : 'bg-teal-600 hover:bg-teal-500 text-white'
                } ${loadingPlanId === plan.id ? 'opacity-50' : ''}`}
                disabled={isCurrent || loadingPlanId !== null}
                onClick={() => !isCurrent && handleSubscribe(plan.id)}
              >
                {isCurrent ? 'Current' : loadingPlanId === plan.id ? 'Processing...' : isFree ? 'Get Started' : 'Subscribe'}
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
