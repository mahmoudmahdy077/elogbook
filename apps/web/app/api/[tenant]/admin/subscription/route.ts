import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

const ADMIN_ROLES = ['institution_admin', 'admin'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as unknown as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  if (!ADMIN_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as unknown as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  if (!ADMIN_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json();
  const { plan_id, reason } = body;

  if (!plan_id) {
    return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
  }

  // Verify plan exists
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('id', plan_id)
    .single();

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  // Get current subscription
  const { data: currentSub } = await supabase
    .from('subscriptions')
    .select('id, plan_id, status')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  // Determine change type
  let changeType: 'upgrade' | 'downgrade' | 'custom' = 'custom';
  if (currentSub) {
    const currentPlan = await supabase
      .from('subscription_plans')
      .select('price_monthly')
      .eq('id', currentSub.plan_id)
      .single();

    if (currentPlan) {
      changeType = plan.price_monthly > (currentPlan.data?.price_monthly ?? 0) ? 'upgrade' : 'downgrade';
    }
  }

  // Update or create subscription
  if (currentSub) {
    const { error } = await supabase
      .from('subscriptions')
      .update({
        plan_id,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentSub.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from('subscriptions')
      .insert({
        tenant_id: profile.tenant_id,
        plan_id,
        status: 'active',
      });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log the change
  await supabase.from('subscription_changes').insert({
    tenant_id: profile.tenant_id,
    old_plan_id: currentSub?.plan_id ?? null,
    new_plan_id: plan_id,
    change_type: changeType,
    reason: reason || null,
    changed_by: user.id,
  });

  // Audit log
  await supabase.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'change_subscription',
    resource_type: 'subscriptions',
    resource_id: profile.tenant_id,
    changes: { old_plan: currentSub?.plan_id, new_plan: plan_id, change_type: changeType },
  });

  return NextResponse.json({ success: true, change_type: changeType });
}
