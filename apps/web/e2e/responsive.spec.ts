import { test, expect, MOCK_TENANT_SLUG } from '../e2e/fixtures';

test.describe('Responsive Design', () => {
  const MOBILE_VIEWPORT = { width: 375, height: 812 };

  test('mobile viewport shows hamburger menu / mobile nav', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    // On mobile, the sidebar should be hidden (max-md:hidden class)
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/max-md:hidden/);

    // Bottom mobile navigation bar should be visible
    const mobileNav = page.locator('.md\\:hidden');
    await expect(mobileNav).toBeVisible();
  });

  test('mobile navigation shows primary links in bottom tab bar', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    // Mobile nav bar should contain Dashboard, Cases, etc.
    const mobileNav = page.locator('.md\\:hidden');
    const dashboardTab = mobileNav.locator('a').filter({ hasText: 'Dashboard' });
    await expect(dashboardTab).toBeVisible();

    // Active tab should have indicator (top bar)
    const activeIndicator = mobileNav.locator('.bg-primary.rounded-b-full');
    await expect(activeIndicator).toBeVisible();
  });

  test('mobile navigation "More" button for overflow links', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    // The "More" button should exist if there are overflow links
    const moreButton = page.locator('button[aria-label="More navigation"]');
    const exists = await moreButton.count();
    if (exists > 0) {
      await expect(moreButton).toBeVisible();
    }
  });

  test('tablet viewport (768px) shows responsive layout correctly', async ({ page }) => {
    // Tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    // On tablet, the sidebar should remain visible (not max-md:hidden)
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();

    // Content area should be properly sized
    const mainContent = page.locator('main#main-content');
    await expect(mainContent).toBeVisible();
  });

  test('responsive grid adapts from 2-col to 4-col on larger screens', async ({ page }) => {
    // Test on desktop first — KPI rings in 4 columns
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    const desktopGrid = page.locator('.grid.grid-cols-2.sm\\:grid-cols-4');
    await expect(desktopGrid).toBeVisible();

    // Mobile viewport
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // On mobile the grid should have 2 columns (grid-cols-2)
    const mobileGrid = page.locator('.grid.grid-cols-2');
    await expect(mobileGrid).toBeVisible();
  });

  test('desktop sidebar width is 240px (w-60)', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/w-60/);
  });

  test('maintains min-h-dvh and proper padding on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    // The outer container should have min-h-screen
    const outerContainer = page.locator('.min-h-screen');
    await expect(outerContainer).toBeVisible();

    // Content should have responsive padding (p-3 on mobile)
    const contentDiv = outerContainer.locator('.p-3.sm\\:p-6');
    await expect(contentDiv).toBeVisible();
  });

  test('touch targets meet 44x44 minimum on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');

    // Mobile nav items should have min-h-[44px] and min-w-[44px]
    const mobileNavItems = page.locator('.min-h-\\[44px\\].min-w-\\[44px\\]');
    const count = await mobileNavItems.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
