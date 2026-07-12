import { test as base, type Page } from '@playwright/test';

/**
 * Stub Supabase auth by setting a mock session cookie.
 * The actual auth pages read the cookie via @supabase/ssr on the server side.
 * For E2E tests we navigate directly and let the middleware redirect us,
 * or we seed the cookie so the app thinks we're authenticated.
 */

export const MOCK_TENANT_SLUG = 'demo-hospital';

/**
 * Set a minimal localStorage state to simulate an authenticated session
 * on the client side. This allows us to test UI elements without a real
 * Supabase backend.
 */
export async function stubAuthSession(page: Page) {
  await page.evaluate(() => {
    // Simulate a minimal session object that satisfies the app's auth checks
    // at the client-component level (e.g. DashboardContent, Sidebar).
    // The actual server-side redirects depend on getAuthContext() which reads
    // cookies. For client-component tests we rely on the page rendering after
    // auth has been bypassed or the component tree is available.
    localStorage.setItem(
      'supabase-auth-token',
      JSON.stringify({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
  });
}

/**
 * Navigate to an authenticated route directly. This bypasses the login page
 * and simulates being inside the (authenticated) layout.
 * We stub auth first, then navigate so client components can read the session.
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

/**
 * Helper: get a data-testid selector
 */
export function testId(id: string) {
  return `[data-testid="${id}"]`;
}
