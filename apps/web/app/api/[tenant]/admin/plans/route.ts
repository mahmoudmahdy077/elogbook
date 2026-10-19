import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';

const ADMIN_ROLES = ['institution_admin', 'admin'];

// The plan catalog is the entitlement source of truth: `features` is read by
// `check_case_quota` (where `max_cases: 0` means unlimited) and `price_monthly`
// is what a checkout charges. A tenant-writable catalog row is therefore a
// tenant-authored entitlement, so the route is read-only.
//
// Reads are preserved so the billing page and admin tab keep listing plans.
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

  // Get all plans with features
  const { data: plans, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .order('price_monthly', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to load plans' }, { status: 500 });
  }

  // Get custom features for each plan
  const planIds = (plans ?? []).map((p) => p.id);
  const { data: features } = await supabase
    .from('custom_plan_features')
    .select('*')
    .in('plan_id', planIds);

  // Group features by plan
  const featuresByPlan = new Map<string, unknown[]>();
  for (const f of features ?? []) {
    const existing = featuresByPlan.get(f.plan_id) || [];
    existing.push(f);
    featuresByPlan.set(f.plan_id, existing);
  }

  const enrichedPlans = (plans ?? []).map((p) => ({
    ...p,
    custom_features: featuresByPlan.get(p.id) || [],
  }));

  return NextResponse.json({ plans: enrichedPlans });
}

const CATALOG_IMMUTABLE = {
  error:
    'The plan catalog is platform-owned. Plan entitlements, pricing and feature flags are set by the platform, not by a tenant.',
  code: 'plan_catalog_is_platform_owned',
};

export async function POST() {
  return NextResponse.json(CATALOG_IMMUTABLE, { status: 403 });
}

export async function PUT() {
  return NextResponse.json(CATALOG_IMMUTABLE, { status: 403 });
}

export async function DELETE() {
  return NextResponse.json(CATALOG_IMMUTABLE, { status: 403 });
}
