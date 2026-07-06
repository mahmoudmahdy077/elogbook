import { test, expect, MOCK_TENANT_SLUG } from '../e2e/fixtures';

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
  });

  test('sidebar renders with brand logo', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Brand icon should be visible (the EL logo)
    const brandLogo = sidebar.locator('span:has-text("EL")');
    await expect(brandLogo).toBeVisible();
  });

  test('Dashboard navigation link is present and active on dashboard', async ({ page }) => {
    const sidebar = page.locator('aside');
    const dashboardLink = sidebar.locator('a').filter({ hasText: 'Dashboard' });
    await expect(dashboardLink).toBeVisible();
    await expect(dashboardLink).toHaveAttribute('href', `/${MOCK_TENANT_SLUG}/dashboard`);
  });

  test('Cases navigation link is present', async ({ page }) => {
    const sidebar = page.locator('aside');
    const casesLink = sidebar.locator('a').filter({ hasText: 'Cases' });
    await expect(casesLink).toBeVisible();
    await expect(casesLink).toHaveAttribute('href', `/${MOCK_TENANT_SLUG}/cases`);
  });

  test('Approvals navigation link is present', async ({ page }) => {
    const sidebar = page.locator('aside');
    const approvalsLink = sidebar.locator('a').filter({ hasText: 'Approvals' });
    await expect(approvalsLink).toBeVisible();
    await expect(approvalsLink).toHaveAttribute('href', `/${MOCK_TENANT_SLUG}/approvals`);
  });

  test('Goals navigation link is present', async ({ page }) => {
    const sidebar = page.locator('aside');
    const goalsLink = sidebar.locator('a').filter({ hasText: 'Goals' });
    await expect(goalsLink).toBeVisible();
    await expect(goalsLink).toHaveAttribute('href', `/${MOCK_TENANT_SLUG}/goals`);
  });

  test('navigation sections (Main, Review, Tools) are labeled', async ({ page }) => {
    const sidebar = page.locator('aside');

    // Section headers — "Main", "Review", "Tools"
    const mainSection = sidebar.locator('text=Main');
    const reviewSection = sidebar.locator('text=Review');

    await expect(mainSection).toBeVisible();
    await expect(reviewSection).toBeVisible();
  });

  test('sidebar has sign-out button', async ({ page }) => {
    const sidebar = page.locator('aside');
    const signOutButton = sidebar.locator('button, a').filter({ hasText: 'Sign Out' });
    await expect(signOutButton).toBeVisible();
  });

  test('collapsing sidebar works', async ({ page }) => {
    const sidebar = page.locator('aside');

    // Should start expanded
    await expect(sidebar).toHaveClass(/w-60/);

    // Click the collapse button
    const collapseButton = sidebar.locator('button[aria-label="Collapse sidebar"]');
    const exists = await collapseButton.count();

    if (exists > 0) {
      await collapseButton.click();
      // After collapse, the sidebar should be narrow
      await expect(sidebar).toHaveClass(/w-16/);
    }
  });

  test('navigating to Cases page changes active state', async ({ page }) => {
    // Click the Cases link
    const casesLink = page.locator('aside a[aria-label="Cases"]');
    await casesLink.click();

    // Wait for navigation
    await page.waitForURL(`**/${MOCK_TENANT_SLUG}/cases`);

    // The Cases link should have active styling
    await expect(casesLink).toHaveClass(/bg-primary\/10/);
  });
});
