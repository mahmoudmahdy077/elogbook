import { test as base, type Page } from '@playwright/test';
import { authCookieName } from '../lib/e2e-cookie';

/**
 * E2E auth fixture.
 *
 * The (authenticated) layout runs getAuthContext() server-side, which calls
 * supabase.auth.getUser() against the live Supabase project. A fake
 * localStorage token cannot satisfy it — every authenticated route 307s to
 * /login before client components hydrate.
 *
 * Fix: sign in as the demo resident through the REAL auth API and persist the
 * resulting cookies (@supabase/ssr reads sb-<ref>-auth-token). Server-side
 * getAuthContext then succeeds and pages render with real data. Requires
 * E2E_EMAIL / E2E_PASSWORD (defaults = seeded demo accounts) and network
 * access to the Supabase project.
 *
 * Cookie-name derivation lives in lib/e2e-cookie.ts and matches the app's
 * @supabase/ssr default for cloud, custom-domain, and local origins (T02).
 * The old `*.supabase.co` regex is gone: it produced `sb--auth-token` for
 * self-hosted/local Supabase and failed silently.
 */

export const MOCK_TENANT_SLUG = 'demo';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

/** When set, a failed real login fails the test instead of falling back. */
const REQUIRE_AUTH =
  process.env.E2E_REQUIRE_AUTH === '1' ||
  (process.env.CI === 'true' && process.env.E2E_REQUIRE_AUTH !== '0');

/**
 * Sign in via the Supabase Auth API and seed the @supabase/ssr cookie so
 * server-side getAuthContext() sees a valid session.
 */
export async function stubAuthSession(page: Page) {
  const email = process.env.E2E_EMAIL ?? 'resident@demo.com';
  const password = process.env.E2E_PASSWORD ?? 'password123!';

  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    data: { email, password },
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    },
    failOnStatusCode: false,
  });
  if (process.env.E2E_DEBUG) console.log(`[fixture] auth POST ${res.status()} url=${SUPABASE_URL.slice(0, 30)} for ${email}`);

  if (!res.ok()) {
    const detail = `real Supabase login failed: HTTP ${res.status()} for ${email} against ${SUPABASE_URL.slice(0, 40)}`;
    if (REQUIRE_AUTH) {
      // T02: absent credentials or a down project must fail protected specs,
      // never green them with a fake session.
      throw new Error(
        `[fixture] ${detail}. Set E2E_EMAIL/E2E_PASSWORD and ensure network access to the Supabase project.`,
      );
    }
    if (!SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      throw new Error(
        '[fixture] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are unset. ' +
          'Refusing to seed a fake session: set E2E_REQUIRE_AUTH=0 explicitly to allow the legacy fallback.',
      );
    }
    // Legacy localStorage stub: best-effort only, for public-page specs offline.
    // evaluate() throws on about:blank before any navigation — guard it.
    try {
      await page.evaluate(() => {
        localStorage.setItem(
          'supabase-auth-token',
          JSON.stringify({
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        );
      });
    } catch {
      // no document yet — harmless for public pages
    }
    return;
  }

  const session = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    expires_in?: number;
    user: unknown;
  };

  const authTokenValue = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in ?? 3600,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: session.user,
  });

  // @supabase/ssr cookie format: base64-URL-encoded JSON inside sb-<ref>-auth-token
  // (ref derivation matches the app's supabase-js default for any origin).
  await page.context().addCookies([
    {
      name: authCookieName(SUPABASE_URL),
      value: 'base64-' + Buffer.from(authTokenValue).toString('base64'),
      url: process.env.BASE_URL ?? 'http://localhost:3000',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Navigate to an authenticated route directly. Seeds auth first, then navigates.
 */
export async function goToAuthenticatedRoute(
  page: Page,
  route: string,
  tenantSlug: string = MOCK_TENANT_SLUG,
) {
  await page.goto(`/${tenantSlug}${route}`);
  // Wait for the shell layout to render (sidebar, main content area)
  await page.waitForLoadState('networkidle');
}

// Extend the base test so EVERY spec importing this module gets an
// auth-seeded page (real Supabase session cookie). Public-page specs are
// unaffected — an extra valid session cookie is harmless there.
export const test = base.extend<{
  page: Page;
}>({
  page: async ({ page }, use) => {
    await stubAuthSession(page);
    await use(page);
  },
});

// Un-seeded test for specs that exercise PUBLIC pages (/login, /signup,
// /pricing). A seeded session would make the middleware bounce /login to
// the tenant dashboard, breaking every assertion on that page.
export const publicTest = base;

export { expect } from '@playwright/test';
