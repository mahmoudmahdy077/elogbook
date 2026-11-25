import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { UserRole } from '@elogbook/shared';
import { getSession } from './session';

export type AuthGuardState = {
  isAuthenticated: boolean;
  isLoading: boolean;
};

export type AuthStateListener = (state: AuthGuardState) => void;

/**
 * DISPLAY-ONLY role hint (M1). Reads JWT metadata for fast UI labels.
 * NEVER use for authorization — every capability/data query must be enforced
 * by the server capability snapshot (lib/capability.ts) + RLS, which handles
 * suspension, expiry, MFA step-up, and tenant changes.
 * The promised profile fallback is intentionally NOT implemented here;
 * use fetchCapabilitySnapshot() for authoritative user/tenant/status/policy.
 */
export async function getRoleFromAuth(): Promise<{
  role: UserRole | null;
  fullName: string | null;
  tenantId: string | null;
  profileId: string | null;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { role: null, fullName: null, tenantId: null, profileId: null };

  const role = (user.user_metadata?.role as UserRole) ?? null;
  const fullName = (user.user_metadata?.full_name as string) ?? null;
  const tenantId = (user.app_metadata?.tenant_id as string) ?? null;
  const profileId = (user.app_metadata?.profile_id as string) ?? null;

  return { role, fullName, tenantId, profileId };
}

/**
 * Authoritative role for authorization decisions (tabs, PHI gates).
 *
 * Uses the server capability snapshot first (role/status come from `profiles`
 * via RLS and are cached for offline), then a direct `profiles` read. It never
 * trusts `user_metadata.role`, which any authenticated user can rewrite with
 * `auth.updateUser({ data: { role: 'admin' } })`.
 */
export async function getAuthoritativeRole(): Promise<UserRole | null> {
  const cap = getSession().capability;
  if (cap && cap.status === 'active' && cap.role) return cap.role as UserRole;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('user_id', user.id)
      .maybeSingle();

    const profile = data as { role?: UserRole; status?: string } | null;
    if (!profile || profile.status !== 'active' || !profile.role) return null;
    return profile.role;
  } catch {
    return null;
  }
}

export function subscribeToAuth(
  supabaseClient: Pick<typeof supabase, 'auth'> = supabase,
  listener: AuthStateListener = () => undefined,
): () => void {
  let isActive = true;

  supabaseClient.auth
    .getSession()
    .then(({ data: { session } }) => {
      if (!isActive) return;
      listener({ isAuthenticated: !!session, isLoading: false });
    })
    .catch(() => {
      if (!isActive) return;
      listener({ isAuthenticated: false, isLoading: false });
    });

  const {
    data: { subscription },
  } = supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (!isActive) return;
    listener({ isAuthenticated: !!session, isLoading: false });
  });

  return () => {
    isActive = false;
    subscription?.unsubscribe();
  };
}

export function useAuthGuard(): AuthGuardState {
  const [state, setState] = useState<AuthGuardState>({
    isAuthenticated: false,
    isLoading: true,
  });

  useEffect(() => {
    return subscribeToAuth(supabase, setState);
  }, []);

  return state;
}
