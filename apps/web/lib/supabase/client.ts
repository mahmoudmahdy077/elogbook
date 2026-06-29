import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Get the singleton browser Supabase client.
 *
 * During the Next.js build-time prerender step, env vars are not
 * injected (Vercel injects them at runtime). The previous version
 * threw eagerly at module load, which crashed the build. We now
 * throw only when the client is actually used at request time.
 * Returning a Proxy that defers the throw to first method call
 * keeps the build happy while still failing loudly at runtime
 * when env vars are missing.
 */
export function createClient() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Defer the error to first method invocation so that the
    // build-time prerender (which imports but does not call)
    // doesn't crash.
    return new Proxy({}, {
      get(_target, prop) {
        throw new Error(
          `Missing Supabase env var(s) — NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ` +
          `Tried to call supabase.${String(prop)}(). Set these in your Vercel project env vars.`
        );
      },
    }) as ReturnType<typeof createBrowserClient>;
  }

  client = createBrowserClient(url, key);
  return client;
}