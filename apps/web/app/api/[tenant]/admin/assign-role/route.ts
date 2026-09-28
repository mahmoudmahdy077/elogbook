import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';
import { logger } from '@/lib/logger';

/**
 * Role assignment.
 *
 * `profile_id` is the profiles surrogate key (profiles.id), which is what
 * public.admin_assign_role(p_profile_id, p_role) resolves its target by. The
 * request field used to be called `user_id`, which is auth.users.id -- a
 * different key that the RPC never accepted, so a caller who read the field
 * name literally got a bare 404 for a perfectly valid profile. The name now
 * matches the RPC parameter.
 */
const assignRoleSchema = z.object({
  profile_id: z.string().trim().min(1).max(128),
  role: z.enum(['resident', 'supervisor', 'director', 'institution_admin', 'admin']),
}).strict();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const guarded = await guardRequest(request, assignRoleSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 8 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`assign-role:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;

  const { profile_id: profileId, role } = guarded.data;

  if (role === 'admin' && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can assign the admin role.' }, { status: 403 });
  }

  const { data: result, error: profileError } = await supabase.rpc('admin_assign_role', {
    p_profile_id: profileId,
    p_role: role,
  });
  const resultCode = (result as { success?: boolean; error?: string } | null)?.error;
  const success = (result as { success?: boolean } | null)?.success === true;
  if (profileError || !success) {
    logger.error('Failed to assign role', profileError, { tenantSlug });
    if (resultCode === 'profile_not_found') {
      return NextResponse.json({ error: 'Target user not found.' }, { status: 404 });
    }
    if (resultCode === 'forbidden' || resultCode === 'tenant_inactive') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    if (resultCode === 'last_administrator') {
      return NextResponse.json({ error: 'Cannot remove the last institution admin of this tenant' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to assign role' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}