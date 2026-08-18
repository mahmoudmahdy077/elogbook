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

  // Get all plans with features
  const { data: plans, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .order('price_monthly', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Get custom features for each plan
  const planIds = (plans ?? []).map(p => p.id);
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

  const enrichedPlans = (plans ?? []).map(p => ({
    ...p,
    custom_features: featuresByPlan.get(p.id) || [],
  }));

  return NextResponse.json({ plans: enrichedPlans });
}

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
  const { name, slug, price_monthly, features, tenant_type, max_residents, custom_features } = body;

  if (!name || !slug || price_monthly === undefined || !tenant_type) {
    return NextResponse.json({ error: 'name, slug, price_monthly, and tenant_type are required' }, { status: 400 });
  }

  // Check slug uniqueness
  const { data: existing } = await supabase
    .from('subscription_plans')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A plan with this slug already exists' }, { status: 409 });
  }

  // Create plan
  const { data: plan, error } = await supabase
    .from('subscription_plans')
    .insert({
      name,
      slug,
      price_monthly,
      features: features || {},
      tenant_type,
      max_residents: max_residents || null,
      is_custom: true,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Create custom features
  if (custom_features && Array.isArray(custom_features)) {
    for (const f of custom_features) {
      await supabase.from('custom_plan_features').insert({
        plan_id: plan.id,
        feature_key: f.key,
        feature_value: f.value,
      });
    }
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'create_plan',
    resource_type: 'subscription_plans',
    resource_id: plan.id,
    changes: { name, slug, price_monthly },
  });

  return NextResponse.json({ plan }, { status: 201 });
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
  const { id, name, slug, price_monthly, features, tenant_type, max_residents, custom_features } = body;

  if (!id) {
    return NextResponse.json({ error: 'Plan id is required' }, { status: 400 });
  }

  // Check plan exists
  const { data: existingPlan } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('id', id)
    .single();

  if (!existingPlan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  // Update plan
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (slug !== undefined) updates.slug = slug;
  if (price_monthly !== undefined) updates.price_monthly = price_monthly;
  if (features !== undefined) updates.features = features;
  if (tenant_type !== undefined) updates.tenant_type = tenant_type;
  if (max_residents !== undefined) updates.max_residents = max_residents;

  const { error } = await supabase
    .from('subscription_plans')
    .update(updates)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update custom features
  if (custom_features && Array.isArray(custom_features)) {
    // Delete existing features
    await supabase.from('custom_plan_features').delete().eq('plan_id', id);

    // Insert new features
    for (const f of custom_features) {
      await supabase.from('custom_plan_features').insert({
        plan_id: id,
        feature_key: f.key,
        feature_value: f.value,
      });
    }
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'update_plan',
    resource_type: 'subscription_plans',
    resource_id: id,
    changes: updates,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
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

  const { searchParams } = new URL(request.url);
  const planId = searchParams.get('id');

  if (!planId) {
    return NextResponse.json({ error: 'Plan id is required' }, { status: 400 });
  }

  // Check if plan has active subscriptions
  const { count } = await supabase
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', planId)
    .eq('status', 'active');

  if (count && count > 0) {
    return NextResponse.json({ error: `Cannot delete: ${count} active subscriptions use this plan` }, { status: 409 });
  }

  // Only allow deleting custom plans
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('is_custom')
    .eq('id', planId)
    .single();

  if (!plan?.is_custom) {
    return NextResponse.json({ error: 'Cannot delete default plans' }, { status: 400 });
  }

  const { error } = await supabase
    .from('subscription_plans')
    .delete()
    .eq('id', planId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit log
  await supabase.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'delete_plan',
    resource_type: 'subscription_plans',
    resource_id: planId,
  });

  return NextResponse.json({ success: true });
}
