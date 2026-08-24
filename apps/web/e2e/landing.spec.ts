import { test, expect } from '@playwright/test';

// Dev server compiles routes on demand; under parallel workers the first hit
// can take many seconds before hydration completes.
test.setTimeout(60000);

test('landing page has Sign up free link to /signup', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: /sign up free/i });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/signup/, { timeout: 30000 });
  await expect(page).toHaveURL(/\/signup/);
});

test('landing page has Pricing link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /pricing/i }).click();
  await page.waitForURL(/\/pricing/, { timeout: 30000 });
  await expect(page).toHaveURL(/\/pricing/);
});

test('landing page footer does NOT claim SOC 2', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await expect(footer).not.toContainText('SOC 2');
});
