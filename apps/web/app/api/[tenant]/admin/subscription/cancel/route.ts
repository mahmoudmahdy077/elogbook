import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

const ADMIN_ROLES = ['institution_admin', 'admin'];

export async function POST(
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
  const { reason } = body;

  // Get current subscription
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id, plan_id, status')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  if (!subscription) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
  }

  if (subscription.status === 'canceled') {
    return NextResponse.json({ error: 'Subscription already canceled' }, { status: 400 });
  }

  // Update subscription status
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      cancellation_reason: reason || null,
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscription.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log the change
  await supabase.from('subscription_changes').insert({
    tenant_id: profile.tenant_id,
    old_plan_id: subscription.plan_id,
    new_plan_id: subscription.plan_id,
    change_type: 'cancel',
    reason: reason || null,
    changed_by: user.id,
  });

  // Audit log
  await supabase.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'cancel_subscription',
    resource_type: 'subscriptions',
    resource_id: subscription.id,
    changes: { reason },
  });

  return NextResponse.json({ success: true, message: 'Subscription canceled' });
}
