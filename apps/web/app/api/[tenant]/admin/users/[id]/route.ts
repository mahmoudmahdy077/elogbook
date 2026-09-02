import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const { profile } = _auth;

  const { data: targetProfile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (error || !targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Get auth user info
  const adminClient = createServiceRoleClient();
  const { data: authUser } = await adminClient.auth.admin.getUserById(targetProfile.user_id);

  return NextResponse.json({
    profile: targetProfile,
    email: authUser?.user?.email,
    last_sign_in: authUser?.user?.last_sign_in_at,
    email_confirmed: authUser?.user?.email_confirmed_at,
  });
}

export async function PUT(
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
  const { full_name, specialty, role, status } = body;

  // Validate role
  const validRoles = ['resident', 'supervisor', 'director', 'institution_admin', 'admin'];
  if (role && !validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  // Validate status
  const validStatuses = ['active', 'pending', 'suspended', 'deactivated'];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  // Only admin can assign admin role
  if (role === 'admin' && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can assign admin role' }, { status: 403 });
  }

  const adminClient = createServiceRoleClient();

  // Get target user — must belong to same tenant (service-role bypasses RLS)
  const { data: targetProfile } = await adminClient
    .from('profiles')
    .select('id, user_id, role, tenant_id')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if ((targetProfile as { tenant_id: string }).tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Target user is not in the same tenant' }, { status: 403 });
  }

  // Update profile
  const updates: Record<string, unknown> = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (specialty !== undefined) updates.specialty = specialty;
  if (role !== undefined) updates.role = role;
  if (status !== undefined) {
    updates.status = status;
    if (status === 'deactivated') updates.deactivated_at = new Date().toISOString();
    if (status === 'active') updates.deactivated_at = null;
  }
  updates.updated_at = new Date().toISOString();

  const { error: updateError } = await adminClient
    .from('profiles')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Update auth user role if changed
  if (role && role !== targetProfile.role) {
    await adminClient.auth.admin.updateUserById(targetProfile.user_id, {
      app_metadata: { user_role: role },
    });
  }

  // Audit log
  await adminClient.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'update_user',
    resource_type: 'profiles',
    resource_id: id,
    changes: updates,
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(
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

  const adminClient = createServiceRoleClient();

  // Get target user — must belong to same tenant (service-role bypasses RLS)
  const { data: targetProfile } = await adminClient
    .from('profiles')
    .select('id, user_id, tenant_id')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if ((targetProfile as { tenant_id: string }).tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Target user is not in the same tenant' }, { status: 403 });
  }

  // Prevent self-deletion
  if (targetProfile.user_id === user.id) {
    return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
  }

  // Delete auth user (cascades to profile)
  const { error } = await adminClient.auth.admin.deleteUser(targetProfile.user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit log
  await adminClient.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'delete_user',
    resource_type: 'profiles',
    resource_id: id,
  });

  return NextResponse.json({ success: true });
}
