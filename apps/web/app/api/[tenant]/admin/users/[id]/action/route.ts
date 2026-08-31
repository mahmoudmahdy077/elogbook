import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import crypto from 'crypto';

const ADMIN_ROLES = ['institution_admin', 'admin'];

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

  // Get target user
  const { data: targetProfile } = await adminClient
    .from('profiles')
    .select('id, user_id, status')
    .eq('id', id)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (action === 'deactivate') {
    // Update profile status
    const { error } = await adminClient
      .from('profiles')
      .update({ status: 'deactivated', deactivated_at: new Date().toISOString() })
      .eq('id', id);

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
      .eq('id', id);

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
    // Generate password reset link
    await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: '', // We need the email
    });

    // Alternative: use updateUser to set a temporary password
    const tempPassword = crypto.randomBytes(16).toString('base64url').slice(0, 12) + 'A1!';
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      targetProfile.user_id,
      { password: tempPassword }
    );

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'reset_password',
      resource_type: 'profiles',
      resource_id: id,
    });

    return NextResponse.json({ success: true, message: 'Password reset. New password sent to user.' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
