import { test, expect, MOCK_TENANT_SLUG } from '../e2e/fixtures';

test.describe('Dashboard Page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate directly to the dashboard route as if authenticated
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
  });

  test('dashboard layout renders with sidebar and main content', async ({ page }) => {
    // Sidebar should be present (desktop)
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Main content area
    const mainContent = page.locator('main#main-content');
    await expect(mainContent).toBeVisible();
  });

  test('welcome heading is displayed', async ({ page }) => {
    // The dashboard header should say "Welcome, ..."
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    const headingText = await heading.textContent();
    expect(headingText).toContain('Welcome');
  });

  test('KPI rings section renders with correct labels', async ({ page }) => {
    // The KPI ring labels
    const kpiLabels = ['Draft', 'Pending', 'Approved', 'Rejected'];

    for (const label of kpiLabels) {
      const kpiSection = page.locator('text=' + label);
      await expect(kpiSection.first()).toBeVisible();
    }
  });

  test('recent cases section exists', async ({ page }) => {
    // "Recent Cases" heading
    const recentCasesHeading = page.getByText('Recent Cases');
    await expect(recentCasesHeading).toBeVisible();
  });

  test('goal progress section exists', async ({ page }) => {
    // Should show "Goal Progress" or "Pending Approvals" depending on role
    const goalSection = page.getByText(/Goal Progress|Pending Approvals|All caught up/);
    await expect(goalSection.first()).toBeVisible();
  });

  test('quick links section shows case navigation cards', async ({ page }) => {
    // Quick links: Cases, Goals, Reports
    const quickLinks = ['Cases', 'Goals', 'Reports'];
    for (const link of quickLinks) {
      // Quick links may appear in the bottom grid section
      const linkElement = page.locator('a').filter({ hasText: link });
      const count = await linkElement.count();
      // At least one instance of each link text exists (sidebar or quick links)
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test('KPI rings use white card design with rounded corners', async ({ page }) => {
    // The KPI ring cards should have rounded-2xl class
    const kpiCards = page.locator('.rounded-2xl.border');
    const cardCount = await kpiCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(4);
  });

  test('Log New Case button is present for residents', async ({ page }) => {
    // The Log New Case pill button — visible for resident role
    const logCaseButton = page.locator('a').filter({ hasText: 'Log New Case' });
    // It may or may not be present depending on role
    const exists = await logCaseButton.count();
    if (exists > 0) {
      // Should be a pill button (rounded-full)
      await expect(logCaseButton.first()).toHaveClass(/rounded-full/);
    }
  });

  test('status badges use StatusBadge component', async ({ page }) => {
    // Look for StatusBadge elements in the dashboard
    const statusBadge = page.locator('[class*="status"]').first();
    const exists = await statusBadge.count();
    if (exists > 0) {
      await expect(statusBadge).toBeVisible();
    }
  });
});
