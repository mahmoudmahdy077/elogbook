import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type AuthGuardState = {
  isAuthenticated: boolean;
  isLoading: boolean;
};

export type AuthStateListener = (state: AuthGuardState) => void;

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
