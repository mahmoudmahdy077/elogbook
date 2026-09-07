/**
 * Auth-cookie naming for the E2E harness (T02).
 *
 * The app creates its Supabase clients via @supabase/ssr without an explicit
 * `cookieOptions.name`, so the session cookie name falls through to the
 * supabase-js default. Pinned derivation (supabase-js 2.112.3, verified
 * against `node_modules/.pnpm/@supabase+supabase-js@2.112.3...`):
 *
 *   `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
 *
 * Consequences the old fixture got wrong: it regex-matched only
 * `*.supabase.co`, so self-hosted (`https://api.example.com` →
 * `sb-api-auth-token`) and local (`http://127.0.0.1:54321` → `sb-127-auth-token`,
 * `http://localhost:54321` → `sb-localhost-auth-token`) origins produced an
 * empty ref (`sb--auth-token`) and auth seeding silently failed.
 *
 * If the dependency upgrades, re-verify this derivation against the installed
 * supabase-js before trusting E2E auth again.
 */

export function deriveCookieProjectRef(supabaseUrl: string): string {
  const hostname = new URL(supabaseUrl).hostname;
  const ref = hostname.split('.')[0];
  if (!ref) {
    throw new Error(
      `[e2e-cookie] cannot derive auth-cookie ref from Supabase URL ${supabaseUrl}`,
    );
  }
  return ref;
}

export function authCookieName(supabaseUrl: string): string {
  return `sb-${deriveCookieProjectRef(supabaseUrl)}-auth-token`;
}
