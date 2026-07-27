import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { UserRole } from '@elogbook/shared';

export type AuthGuardState = {
  isAuthenticated: boolean;
  isLoading: boolean;
};

export type AuthStateListener = (state: AuthGuardState) => void;

/**
 * Extract role from JWT user_metadata (fast, no DB query).
 * Falls back to reading from profiles table if metadata is missing.
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
