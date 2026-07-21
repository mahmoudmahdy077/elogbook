import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { parseWebServerEnv, parseWebPublicEnv } from '@elogbook/env';

export async function createServerSupabase() {
  const env = parseWebServerEnv(process.env);
  const publicEnv = parseWebPublicEnv(process.env);
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });
}