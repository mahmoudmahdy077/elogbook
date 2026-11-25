import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }

  const rl = await checkRateLimit(`admin-user-action:${tenantSlug}`, 20);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
  const profile = _auth.profile;
  const user = _auth.user;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
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

    // Profile status alone does not stop anything: RLS reads the role from the
    // JWT, never profiles.status, and the session stays valid. Ban the auth
    // user so existing refresh tokens stop working (~100 years).
    const { error: banError } = await adminClient.auth.admin.updateUserById(
      targetProfile.user_id,
      { ban_duration: '876000h' },
    );
    if (banError) {
      console.error('[admin/users/action] ban failed:', banError.message);
      return NextResponse.json({ error: 'User deactivated but sign-in could not be blocked' }, { status: 500 });
    }

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

    const { error: unbanError } = await adminClient.auth.admin.updateUserById(
      targetProfile.user_id,
      { ban_duration: 'none' },
    );
    if (unbanError) {
      console.error('[admin/users/action] unban failed:', unbanError.message);
      return NextResponse.json({ error: 'User reactivated but sign-in could not be re-enabled' }, { status: 500 });
    }

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

    // generateLink() only mints a URL; the old code discarded it and still
    // told the admin an email had been sent. Ask GoTrue to send it instead.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const { error: mailError } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${siteUrl}/auth/callback?type=recovery`,
    });

    if (mailError) {
      console.error('[admin/users/action] reset mail failed:', mailError.message);
      return NextResponse.json(
        { error: 'Could not send the reset email. Check the mail provider configuration.' },
        { status: 502 },
      );
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
