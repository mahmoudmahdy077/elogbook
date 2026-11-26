import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

/**
 * POST /api/[tenant]/admin/invite
 *
 * Invites a member by email. The invite row is what `handle_new_user` reads to
 * place the account in this tenant with the right role, so the old flow's
 * second `profiles.insert` (which hit the user_id unique constraint) is gone.
 *
 * Delivery uses Supabase Auth's built-in invite mail. If the deployment has no
 * SMTP configured, Supabase returns an error and we surface it instead of
 * claiming success.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`invite:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;
  const user = auth.user;

  let body: { email?: string; full_name?: string; role?: string; specialty?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const email = (body.email ?? '').trim().toLowerCase();
  const full_name = (body.full_name ?? '').trim().slice(0, 200);
  const inviteRole = body.role ?? 'resident';
  const specialty = (body.specialty ?? '').trim().slice(0, 120) || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !full_name) {
    return NextResponse.json({ error: 'A valid email and full name are required.' }, { status: 400 });
  }

  // director+ profiles cannot be created until the account has a verified MFA
  // factor (trg_enforce_mfa), so those roles are promoted after enrolment.
  const validRoles = ['resident', 'supervisor'];
  if (!validRoles.includes(inviteRole)) {
    return NextResponse.json(
      { error: 'Directors are promoted after MFA enrolment. Invite as supervisor, then change the role.' },
      { status: 400 },
    );
  }

  const adminClient = createServiceRoleClient();

  const { error: inviteRowError } = await adminClient.from('tenant_invites').insert({
    tenant_id: profile.tenant_id,
    email,
    role: inviteRole,
    invited_by: user.id,
    status: 'pending',
  });

  if (inviteRowError) {
    return NextResponse.json({ error: inviteRowError.message }, { status: 500 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name, specialty, role: inviteRole },
    redirectTo: `${siteUrl}/auth/callback?next=/onboarding`,
  });

  if (inviteError) {
    // Roll the invite row back so a failed send does not leave a dangling
    // pending invite that would silently bind a future signup.
    await adminClient.from('tenant_invites').delete().eq('tenant_id', profile.tenant_id).eq('email', email).eq('status', 'pending');
    return NextResponse.json(
      { error: `Invitation email could not be sent: ${inviteError.message}` },
      { status: 502 },
    );
  }

  // audit_logs.resource_id is NOT NULL before 20261126000600; passing null
  // made this insert fail with 23502 while the error was ignored, so the
  // invitation left no audit row. Prefer the invited account's id.
  const { error: auditError } = await adminClient.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'invite_user',
    resource_type: 'profiles',
    resource_id: invited?.user?.id ?? user.id,
    changes: { email, full_name, role: inviteRole },
  });
  if (auditError) {
    console.error('[audit] invite_user audit write failed:', auditError.message);
  }

  return NextResponse.json({ success: true, message: `Invitation sent to ${email}` });
}
