import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const updateUserSchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  specialty: z.string().trim().max(120).nullable().optional(),
  role: z.enum(['resident', 'supervisor', 'director', 'institution_admin', 'admin']).optional(),
  status: z.enum(['active', 'pending', 'suspended', 'deactivated']).optional(),
}).strict();

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

  const rl = await checkRateLimit(`admin-user-detail:${tenantSlug}`, 60);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
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
  const guarded = await guardRequest(request, updateUserSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 8 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }

  const rl = await checkRateLimit(`admin-user-mut:${tenantSlug}`, 30);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
  const profile = _auth.profile;

  const { full_name, specialty, role, status } = guarded.data;

  if (role === 'admin' && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can assign admin role' }, { status: 403 });
  }

  const updates: Record<string, string | null> = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (specialty !== undefined) updates.specialty = specialty;
  if (role !== undefined) updates.role = role;
  if (status !== undefined) updates.status = status;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No profile changes supplied' }, { status: 400 });
  }

  const { data: result, error: updateError } = await supabase.rpc('admin_update_profile', {
    p_profile_id: id,
    p_updates: updates,
  });
  const resultCode = (result as { success?: boolean; error?: string } | null)?.error;
  const success = (result as { success?: boolean } | null)?.success === true;
  if (updateError || !success) {
    logger.error('Failed to update user profile', updateError, { tenantSlug });
    if (resultCode === 'profile_not_found') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (resultCode === 'forbidden' || resultCode === 'tenant_inactive') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    if (resultCode === 'last_administrator') {
      return NextResponse.json({ error: 'Cannot remove the last institution admin of this tenant' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to update user profile' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const guarded = await guardRequest(request, undefined, {
    trustedOrigins: defaultTrustedOrigins(request),
    requireBody: false,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }

  const rl = await checkRateLimit(`admin-user-mut:${tenantSlug}`, 30);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
  const profile = _auth.profile;
  const user = _auth.user;

  const { data: targetProfile, error: targetError } = await supabase
    .from('profiles')
    .select('id, user_id, tenant_id, role, status')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();
  if (targetError || !targetProfile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (targetProfile.user_id === user.id) {
    return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 });
  }

  const { data: result, error: deleteError } = await supabase.rpc('admin_delete_profile', {
    p_profile_id: id,
  });
  const resultCode = (result as { success?: boolean; error?: string } | null)?.error;
  const success = (result as { success?: boolean } | null)?.success === true;
  if (deleteError || !success) {
    logger.error('Failed to delete user profile', deleteError, { tenantSlug });
    if (resultCode === 'profile_not_found') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (resultCode === 'forbidden' || resultCode === 'tenant_inactive') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    if (resultCode === 'last_administrator') {
      return NextResponse.json({ error: 'Cannot remove the last institution admin of this tenant' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to delete user profile' }, { status: 500 });
  }

  const adminClient = createServiceRoleClient();
  const { error: authError } = await adminClient.auth.admin.deleteUser(targetProfile.user_id);
  if (authError) {
    logger.error('Failed to delete user identity', authError, { tenantSlug });
    return NextResponse.json({ error: 'Failed to delete user identity' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
