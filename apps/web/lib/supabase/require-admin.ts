import type { SupabaseClient } from '@supabase/supabase-js';
import { getSecurityContext } from './security-context';

function hasSessionApi(supabase: SupabaseClient): boolean {
  const auth = supabase.auth as typeof supabase.auth & { getSession?: unknown };
  return typeof auth.getSession === 'function';
}

function contextError(reason: string): string {
  if (reason === 'unauthenticated' || reason === 'session_required' || reason === 'session_unavailable') {
    return 'Unauthorized';
  }
  if (reason === 'account_inactive') return 'Account is not active';
  if (reason === 'tenant_inactive') return 'Tenant is not active';
  if (reason === 'tenant_not_found') return 'Tenant not found';
  if (reason === 'aal2_required') return 'Re-authentication with MFA required';
  if (reason === 'profile_not_found') return 'Profile not found';
  return 'Security context unavailable';
}

export async function requireTenantAdmin(
  supabase: SupabaseClient,
  tenantSlug: string,
  allowedRoles: string[] = ['institution_admin', 'admin'],
) {
  if (!hasSessionApi(supabase) && process.env.NODE_ENV === 'production') {
    return { ok: false as const, error: 'Security context unavailable', status: 500 as const };
  }

  if (hasSessionApi(supabase)) {
    const security = await getSecurityContext(supabase, { requiredAal: 'aal2' });
    if (!security.ok) {
      return {
        ok: false as const,
        error: contextError(security.reason),
        status: security.status,
      };
    }

    const { context } = security;
    if (context.tenant.slug !== tenantSlug) {
      return { ok: false as const, error: 'Tenant mismatch', status: 403 as const };
    }
    if (!allowedRoles.includes(context.profile.role)) {
      return { ok: false as const, error: 'Insufficient permissions', status: 403 as const };
    }

    return {
      ok: true as const,
      profile: { ...context.profile, tenants: context.tenant },
      user: context.user,
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, error: 'Unauthorized', status: 401 as const };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, user_id, role, status, tenants!inner(slug,status)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return { ok: false as const, error: 'Profile not found', status: 403 as const };
  }

  if ((profile as { status?: string | null }).status !== 'active') {
    return { ok: false as const, error: 'Account is not active', status: 403 as const };
  }

  const tenant = (profile as unknown as { tenants: unknown }).tenants as unknown as
    | { slug: string; status?: string | null }
    | { slug: string; status?: string | null }[];
  const tenantRow = Array.isArray(tenant) ? tenant[0] : tenant;
  if (tenantRow?.slug !== tenantSlug) {
    return { ok: false as const, error: 'Tenant mismatch', status: 403 as const };
  }

  if (tenantRow?.status != null && tenantRow.status !== 'active') {
    return { ok: false as const, error: 'Tenant is not active', status: 403 as const };
  }

  if (!allowedRoles.includes(profile.role)) {
    return { ok: false as const, error: 'Insufficient permissions', status: 403 as const };
  }

  return { ok: true as const, profile, user };
}
