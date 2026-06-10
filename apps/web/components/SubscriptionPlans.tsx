'use client';

import { useState } from 'react';
import { Card, Button } from '@heroui/react';
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
};

function formatMaxResidents(value: number | null): string | null {
  if (!value) return null;
  return `Up to ${value} residents`;
}

function parseFeatures(features: Record<string, unknown>): { label: string; included: boolean }[] {
  const result: { label: string; included: boolean }[] = [];

  for (const [key, value] of Object.entries(features)) {
    if (key === 'max_residents') continue;
    const label = FEATURE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    result.push({ label, included: !!value });
  }

  const maxResidents = features.max_residents as number | null;
  if (maxResidents) {
    result.push({ label: formatMaxResidents(maxResidents)!, included: true });
  }

  return result;
}

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
      <Card>
        <Card.Content>
          <p className="text-default-500">No plans available.</p>
        </Card.Content>
      </Card>
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
        // Redirect to Stripe Checkout
        const stripe = (window as any).Stripe;
        if (stripe) {
          await stripe.redirectToCheckout({ sessionId: data.sessionId });
        } else {
          window.location.href = `https://checkout.stripe.com/pay/${data.sessionId}`;
        }
      } else {
        console.error('No sessionId returned from checkout');
      }
    } catch (err) {
      console.error('Subscribe error:', err);
    } finally {
      setLoadingPlanId(null);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Available Plans</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const features = parseFeatures(plan.features ?? {});

          return (
            <Card
              key={plan.id}
              className={isCurrent ? 'ring-2 ring-primary border-primary' : ''}
            >
              <Card.Header>
                <div className="flex flex-col gap-1 w-full">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{plan.name}</h3>
                    {isCurrent && (
                      <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        Current Plan
                      </span>
                    )}
                  </div>
                  <p className="text-2xl font-bold">
                    ${Number(plan.price_monthly).toFixed(2)}
                    <span className="text-sm font-normal text-default-500">/mo</span>
                  </p>
                </div>
              </Card.Header>
              <Card.Content>
                <ul className="space-y-2">
                  {features.map((f) => (
                    <li
                      key={f.label}
                      className={`flex items-center gap-2 text-sm ${
                        f.included ? 'text-default-700' : 'text-default-300 line-through'
                      }`}
                    >
                      <span className={f.included ? 'text-success' : 'text-default-300'}>
                        {f.included ? '✓' : '✗'}
                      </span>
                      {f.label}
                    </li>
                  ))}
                </ul>
              </Card.Content>
              <Card.Footer>
                <Button
                  color="primary"
                  className="w-full"
                  isLoading={loadingPlanId === plan.id}
                  isDisabled={isCurrent}
                  onPress={() => handleSubscribe(plan.id)}
                >
                  {isCurrent ? 'Current Plan' : 'Subscribe'}
                </Button>
              </Card.Footer>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
