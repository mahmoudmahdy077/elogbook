import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { setUserBanned } from '@/lib/supabase/session-revocation';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const userActionSchema = z.object({
  action: z.enum(['deactivate', 'reactivate', 'reset-password']),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const guarded = await guardRequest(request, userActionSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return guarded.response;

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

  const { action } = guarded.data;

  const { data: targetProfile, error: targetError } = await supabase
    .from('profiles')
    .select('id, user_id, status, tenant_id')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();
  if (targetError || !targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (action === 'deactivate' || action === 'reactivate') {
    const nextStatus = action === 'deactivate' ? 'deactivated' : 'active';
    const { data: result, error: statusError } = await supabase.rpc('admin_set_profile_status', {
      p_profile_id: id,
      p_status: nextStatus,
    });
    const resultCode = (result as { success?: boolean; error?: string } | null)?.error;
    const success = (result as { success?: boolean } | null)?.success === true;
    if (statusError || !success) {
      logger.error('Failed to update user status', statusError, { tenantSlug });
      if (resultCode === 'profile_not_found') {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      if (resultCode === 'forbidden' || resultCode === 'tenant_inactive') {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
      }
      if (resultCode === 'last_administrator') {
        return NextResponse.json({ error: 'Cannot remove the last institution admin of this tenant' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update user status' }, { status: 500 });
    }

    const sessionState = await setUserBanned(targetProfile.user_id, action === 'deactivate');
    if (!sessionState.ok) {
      logger.error('Failed to update auth session state after profile status change', undefined, {
        tenantSlug,
        profileId: id,
        action,
        reason: sessionState.reason,
      });
      return NextResponse.json(
        { error: 'Profile status changed, but session access could not be updated. Retry the action.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: action === 'deactivate' ? 'User deactivated' : 'User reactivated',
    });
  }

  const adminClient = createServiceRoleClient();
  const { data: authUserData, error: getUserError } = await adminClient.auth.admin.getUserById(
    targetProfile.user_id,
  );
  if (getUserError) {
    logger.error('Failed to load user identity', getUserError, { tenantSlug });
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
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
    logger.error('Failed to create password recovery link', linkError, { tenantSlug });
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }

  const auditResult = await adminClient.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'reset_password',
    resource_type: 'profiles',
    resource_id: id,
    changes: { changed_fields: ['recovery'] },
  });
  if (auditResult.error) {
    logger.error('Failed to audit password recovery', auditResult.error, { tenantSlug });
  }

  return NextResponse.json({ success: true, message: 'Password reset email sent' });
}
