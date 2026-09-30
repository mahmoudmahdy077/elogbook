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
  // The AAL2 assertion lives in getSecurityContext, so the fallback below would
  // not carry it. This guard is the sole AAL2 gate for the privileged admin RPCs,
  // so a client without the session API is refused in every environment rather
  // than served by a path that never checks an assurance level.
  if (!hasSessionApi(supabase)) {
    return { ok: false as const, error: 'Security context unavailable', status: 500 as const };
  }

  {
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
}
