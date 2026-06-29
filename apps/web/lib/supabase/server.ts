import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // The server client is only used inside async request handlers
  // (after cookies()), so this is fine at runtime. During the
  // build-time prerender step we shouldn't even reach this —
  // the (authenticated) layout has `dynamic = force-dynamic`.
  // If we somehow do reach it without env vars (e.g. a static page
  // was missed), return a proxy that throws on first method call
  // instead of crashing the build eagerly.
  if (!url || !key) {
    return new Proxy({}, {
      get(_target, prop) {
        throw new Error(
          `Missing Supabase env var(s) at runtime — NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ` +
          `Tried to call supabase.${String(prop)}(). Set these in your Vercel project env vars.`
        );
      },
    }) as ReturnType<typeof createServerClient>;
  }

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