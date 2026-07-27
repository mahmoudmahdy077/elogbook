import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

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
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json();
  const { email, full_name, role: inviteRole, specialty } = body;

  if (!email || !full_name || !inviteRole) {
    return NextResponse.json({ error: 'email, full_name, and role are required.' }, { status: 400 });
  }

  const validRoles = ['resident', 'supervisor', 'director'];
  if (!validRoles.includes(inviteRole)) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();

  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    user_metadata: { full_name, specialty: specialty || null, tenant_id: profile.tenant_id, role: inviteRole },
    email_redirect_to: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback?next=/onboarding`,
  });

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 });
  }

  if (newUser.user) {
    const { error: profileError } = await adminClient.from('profiles').insert({
      id: newUser.user.id,
      user_id: newUser.user.id,
      tenant_id: profile.tenant_id,
      role: inviteRole,
      full_name,
      specialty: specialty || null,
    });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'invite_user', resource_type: 'profiles', resource_id: newUser!.user!.id, changes: { email, full_name, role: inviteRole } });

  return NextResponse.json({ success: true, message: `Invitation sent to ${email}` });
}
