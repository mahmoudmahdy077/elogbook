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

  const { allowed, retryAfter } = await checkRateLimit(`assign-role:${tenantSlug}`);
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
    .select('id, user_id, tenant_id')
    .eq('id', user_id)
    .single();

  if (!targetProfile) {
    return NextResponse.json({ error: 'Target user not found.' }, { status: 404 });
  }

  if (targetProfile.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Target user is not in the same tenant.' }, { status: 403 });
  }

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ role })
    .eq('id', user_id);

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