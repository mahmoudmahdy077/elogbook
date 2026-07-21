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

export default async function PricingPage() {
  const supabase = await createServerSupabase();
  const { data: plans } = await supabase
    .from('subscription_plans')
    .select('id, name, slug, price_monthly, features, tenant_type, max_residents')
    .order('price_monthly', { ascending: true });

  return (
    <div className="min-h-screen bg-backdrop text-text-primary">
      <main className="max-w-5xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-heading font-bold text-center mb-2">Pricing</h1>
        <p className="text-center text-text-secondary mb-12">
          Pick the plan that fits your training. Cancel anytime.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(plans as Plan[] | null ?? [])?.map((plan) => (
            <div key={plan.id} data-testid="plan-card" className="panel p-6 flex flex-col">
              <h2 className="text-xl font-heading font-semibold mb-1">{plan.name}</h2>
              <p className="text-3xl font-bold mb-4">
                ${plan.price_monthly.toFixed(2)}
                <span className="text-sm text-text-muted font-normal">/mo</span>
              </p>
              <ul className="text-sm text-text-secondary space-y-1 mb-6 flex-1">
                {Object.entries(plan.features).map(([k, v]) => (
                  <li key={k}>{v === true ? '✓' : v === false ? '✗' : '•'} {k.replace(/_/g, ' ')}</li>
                ))}
              </ul>
              {plan.slug === 'free' ? (
                <Link href="/signup" className="block text-center py-2 rounded-lg bg-primary text-white font-medium text-sm">Sign up free</Link>
              ) : (
                <Link href={`/signup?plan=${plan.slug}`} className="block text-center py-2 rounded-lg bg-primary text-white font-medium text-sm">Sign up</Link>
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-text-muted mt-12">
          Need SSO, SCIM, or a BAA? <Link href="/contact" className="text-primary underline">Contact us</Link>.
        </p>
      </main>
    </div>
  );
}
