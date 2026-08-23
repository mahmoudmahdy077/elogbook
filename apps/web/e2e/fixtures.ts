import { test as base, type Page } from '@playwright/test';

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
 */

export const MOCK_TENANT_SLUG = 'demo';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? '';

/**
 * Sign in via the Supabase Auth API and seed the @supabase/ssr cookie so
 * server-side getAuthContext() sees a valid session.
 */
export async function stubAuthSession(page: Page) {
  const email = process.env.E2E_EMAIL ?? 'resident@demo.com';
  const password = process.env.E2E_PASSWORD ?? 'password123!';

  const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });

  if (!res.ok()) {
    // Fall back to the legacy localStorage stub so public-page specs still work offline
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
  const encoded = encodeURIComponent(authTokenValue);
  await page.context().addCookies([
    {
      name: `sb-${PROJECT_REF}-auth-token`,
      value: 'base64-' + Buffer.from(authTokenValue).toString('base64'),
      url: process.env.BASE_URL ?? 'http://localhost:3000',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
  // Keep the legacy localStorage stub too — client-side listeners read it on hydration
  await page.evaluate(() => {
    localStorage.setItem('sb-auth-fallback', '1');
  });
  void encoded;
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

// Extend the base test with our custom fixtures
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    await stubAuthSession(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
