import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  const body = await request.json();
  const { action } = body; // 'deactivate' | 'reactivate' | 'reset-password'

  const adminClient = createServiceRoleClient();

  // Get target user — must belong to same tenant (service-role bypasses RLS)
  const { data: targetProfile } = await adminClient
    .from('profiles')
    .select('id, user_id, status, tenant_id')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Defense-in-depth: explicit tenant check even if query predicate is bypassed/missed
  if ((targetProfile as { tenant_id: string }).tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Target user is not in the same tenant' }, { status: 403 });
  }

  if (action === 'deactivate') {
    // Update profile status — scoped to tenant
    const { error } = await adminClient
      .from('profiles')
      .update({ status: 'deactivated', deactivated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log
    await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'deactivate_user',
      resource_type: 'profiles',
      resource_id: id,
    });

    return NextResponse.json({ success: true, message: 'User deactivated' });
  }

  if (action === 'reactivate') {
    const { error } = await adminClient
      .from('profiles')
      .update({ status: 'active', deactivated_at: null })
      .eq('id', id)
      .eq('tenant_id', profile.tenant_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'reactivate_user',
      resource_type: 'profiles',
      resource_id: id,
    });

    return NextResponse.json({ success: true, message: 'User reactivated' });
  }

  if (action === 'reset-password') {
    // Fetch the target auth user's email (required for recovery link)
    const { data: authUserData, error: getUserError } = await adminClient.auth.admin.getUserById(
      targetProfile.user_id,
    );

    if (getUserError) {
      return NextResponse.json({ error: getUserError.message }, { status: 500 });
    }

    const targetEmail = authUserData?.user?.email;
    if (!targetEmail) {
      return NextResponse.json({ error: 'Target user has no email' }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const { error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: targetEmail,
      options: { redirectTo: `${siteUrl}/login` },
    });

    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 500 });
    }

    await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'reset_password',
      resource_type: 'profiles',
      resource_id: id,
    });

    return NextResponse.json({ success: true, message: 'Password reset email sent' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
