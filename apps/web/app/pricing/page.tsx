import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Plan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: 'individual' | 'institution';
  max_residents: number | null;
}

/**
 * Shown when subscription_plans is empty or unreadable (for example RLS denies
 * the anonymous read). Keeps /pricing useful instead of rendering a blank page.
 * Mirrors supabase/migrations/00005_seed_data.sql.
 */
const PLAN_FALLBACK: Plan[] = [
  {
    id: 'fallback-free',
    name: 'Free',
    slug: 'free',
    price_monthly: 0,
    features: { max_cases: 20 },
    tenant_type: 'individual',
    max_residents: null,
  },
  {
    id: 'fallback-individual',
    name: 'Individual Premium',
    slug: 'individual-premium',
    price_monthly: 9.99,
    features: { ai: true, pdf_export: true, goal_tracking: true },
    tenant_type: 'individual',
    max_residents: null,
  },
  {
    id: 'fallback-institution-basic',
    name: 'Institution Basic',
    slug: 'institution-basic',
    price_monthly: 49.99,
    features: { pdf_export: true, approval_workflow: true },
    tenant_type: 'institution',
    max_residents: 10,
  },
  {
    id: 'fallback-institution-pro',
    name: 'Institution Pro',
    slug: 'institution-pro',
    price_monthly: 149.99,
    features: { ai: true, pdf_export: true, approval_workflow: true, goal_tracking: true, audit_trail: true },
    tenant_type: 'institution',
    max_residents: 50,
  },
  {
    id: 'fallback-enterprise',
    name: 'Institution Enterprise',
    slug: 'institution-enterprise',
    price_monthly: 0,
    features: { ai: true, pdf_export: true, approval_workflow: true, goal_tracking: true, audit_trail: true, sso: true },
    tenant_type: 'institution',
    max_residents: null,
  },
];

const FEATURE_LABELS: Record<string, string> = {
  max_cases: 'cases logged',
  ai: 'AI insights',
  pdf_export: 'PDF export',
  approval_workflow: 'Supervisor approval',
  goal_tracking: 'Goal tracking',
  audit_trail: 'Immutable audit trail',
  sso: 'SSO',
  scim: 'SCIM provisioning',
};

function featureLine([key, value]: [string, unknown]): string | null {
  if (value === false || value === null || value === undefined) return null;
  if (key === 'max_cases') return `Up to ${String(value)} cases`;
  if (key === 'max_residents') return null;
  const label = FEATURE_LABELS[key] ?? key.replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function priceLabel(plan: Plan): string {
  if (plan.price_monthly > 0) return `$${plan.price_monthly.toFixed(2)}`;
  if (plan.slug === 'free') return '$0';
  return 'Custom';
}

export default async function PricingPage() {
  let plans: Plan[] = PLAN_FALLBACK;
  let live = false;

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('id, name, slug, price_monthly, features, tenant_type, max_residents')
      .order('price_monthly', { ascending: true });

    if (error) {
      console.error('[pricing] subscription_plans read failed, using fallback', error.message);
    } else if (data && data.length > 0) {
      plans = data as Plan[];
      live = true;
    }
  } catch (err) {
    console.error('[pricing] subscription_plans read threw, using fallback', err);
  }

  return (
    <div className="min-h-screen bg-backdrop text-text-primary">
      <main id="main-content" className="max-w-5xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-heading font-bold text-center mb-2">Pricing</h1>
        <p className="text-center text-text-secondary mb-12">
          Pick the plan that fits your training. Cancel anytime.
        </p>
        {!live ? (
          <p className="mb-8 text-center text-xs text-text-muted" data-testid="pricing-fallback-note">
            Prices below are the standard list prices. Sign in to see your current plan.
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const features = Object.entries(plan.features ?? {})
              .map(featureLine)
              .filter((line): line is string => Boolean(line));
            // Institution plans are provisioned by sales today — self-serve
            // signup always creates an individual tenant, so a "Sign up"
            // button here would silently give the buyer the wrong account type.
            const isInstitution = plan.tenant_type === 'institution';
            return (
              <div key={plan.id} data-testid="plan-card" className="panel flex flex-col p-6">
                <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-text-muted">
                  {plan.tenant_type === 'individual' ? 'Individual' : 'Institution'}
                </p>
                <h2 className="mb-1 font-heading text-xl font-semibold">{plan.name}</h2>
                <p className="mb-4 text-3xl font-bold">
                  {priceLabel(plan)}
                  {plan.price_monthly > 0 ? (
                    <span className="text-sm font-normal text-text-muted">/mo</span>
                  ) : null}
                </p>
                <ul className="mb-6 flex-1 space-y-1 text-sm text-text-secondary">
                  {plan.max_residents ? <li>Up to {plan.max_residents} residents</li> : null}
                  {features.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {isInstitution ? (
                  <Link
                    href="/contact"
                    className="flex min-h-[44px] items-center justify-center rounded-lg border border-border-active py-2 text-center text-sm font-medium text-text-secondary hover:border-primary-glow"
                  >
                    Contact sales
                  </Link>
                ) : (
                  <Link
                    href={plan.slug === 'free' ? '/signup' : `/signup?plan=${plan.slug}`}
                    className="flex min-h-[44px] items-center justify-center rounded-lg bg-primary py-2 text-center text-sm font-medium text-white"
                  >
                    {plan.slug === 'free' ? 'Sign up free' : 'Sign up'}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-12 text-center text-sm text-text-muted">
          Need SSO, SCIM, or a BAA?{' '}
          <Link href="/contact" className="inline-flex min-h-[44px] items-center text-fg-primary underline">
            Contact us
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
