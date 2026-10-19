import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

const ADMIN_ROLES = ['institution_admin', 'admin'];

// Entitlement state is written by a verified Stripe event (service_role) or the
// AAL2 platform command RPCs. It is deliberately NOT writable from a tenant
// route: a tenant admin who can write `subscriptions` can set status='active'
// against any plan with no payment, and `check_case_quota` reads the plan's
// `features.max_cases` (0 meaning unlimited) as the tenant's real capacity.
// Reads are preserved so the billing UI keeps rendering.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, ADMIN_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

  const rl = await checkRateLimit(`admin-subscription:${tenantSlug}`, 60);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  // Get current subscription
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*, plan:subscription_plans(*)')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  // Get all available plans
  const { data: plans } = await supabase
    .from('subscription_plans')
    .select('*')
    .order('price_monthly', { ascending: true });

  // Get payment history
  const { data: payments } = await supabase
    .from('payments')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(20);

  // Get subscription changes
  const { data: changes } = await supabase
    .from('subscription_changes')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    subscription: subscription ?? null,
    plans: plans ?? [],
    payments: payments ?? [],
    changes: changes ?? [],
  });
}

export async function PUT() {
  return NextResponse.json(
    {
      error:
        'Subscription changes are applied by a verified payment event. Start a checkout for the new plan, or manage the existing subscription in the billing portal.',
      code: 'entitlement_requires_payment_event',
    },
    { status: 409 },
  );
}
