/**
 * Bearer-token authentication for the Expo app's mobile API.
 *
 * The web routes authenticate with Supabase auth cookies; a native client has
 * no cookie jar. This helper validates the `Authorization: Bearer <jwt>` the
 * app already holds and builds a user-scoped Supabase client, so every query
 * still runs through RLS as that user — never the service role.
 *
 * This is not a second authorization system: role, tenant and account status
 * remain the database's decision.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseWebPublicEnv } from '@elogbook/env';

export interface MobileAuthSuccess {
  ok: true;
  supabase: SupabaseClient;
  user: { id: string; email?: string };
  token: string;
}

export interface MobileAuthFailure {
  ok: false;
  status: number;
  error: string;
}

export type MobileAuthResult = MobileAuthSuccess | MobileAuthFailure;

export async function authenticateMobileRequest(
  request: Request,
): Promise<MobileAuthResult> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) {
    return { ok: false, status: 401, error: 'Missing bearer token' };
  }
  const token = match[1];

  const env = parseWebPublicEnv(process.env);
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  );

  // Validate the token against GoTrue (never trust a decoded payload).
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { ok: false, status: 401, error: 'Invalid or expired session' };
  }

  return { ok: true, supabase, user: { id: user.id, email: user.email }, token };
}
