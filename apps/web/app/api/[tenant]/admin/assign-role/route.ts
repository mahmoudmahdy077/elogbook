import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { assertNotLastTenantAdmin } from '@/lib/supabase/tenant-admins';
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

  const { allowed, retryAfter } = await checkRateLimit(`assign-role:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  const body = await request.json();
  const { user_id, role } = body;

  if (!user_id || !role) {
    return NextResponse.json({ error: 'user_id and role are required.' }, { status: 400 });
  }

  const validRoles = ['resident', 'supervisor', 'director', 'institution_admin', 'admin'];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
  }

  if (role === 'admin' && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can assign the admin role.' }, { status: 403 });
  }

  const adminClient = createServiceRoleClient();

  const { data: targetProfile } = await adminClient
    .from('profiles')
    .select('id, user_id, tenant_id, role')
    .eq('id', user_id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: 'Target user not found.' }, { status: 404 });
  }

  if (targetProfile.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Target user is not in the same tenant.' }, { status: 403 });
  }

  // T18: never strand a tenant without an institution admin.
  const lastAdmin = await assertNotLastTenantAdmin(adminClient, {
    tenantId: profile.tenant_id,
    profileId: user_id,
    currentRole: (targetProfile as { role: string }).role,
    newRole: role,
  });
  if (!lastAdmin.ok) {
    return NextResponse.json({ error: lastAdmin.error }, { status: lastAdmin.status });
  }

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ role })
    .eq('id', user_id)
    .eq('tenant_id', profile.tenant_id);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (targetProfile.user_id) {
    await adminClient.auth.admin.updateUserById(targetProfile.user_id, {
      app_metadata: { user_role: role },
    });
  }

  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'assign_role', resource_type: 'profiles', resource_id: user_id!, changes: { role } });

  return NextResponse.json({ success: true });
}