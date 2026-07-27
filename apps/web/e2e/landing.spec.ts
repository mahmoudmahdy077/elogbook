import { test, expect } from '@playwright/test';

test('landing page has Sign up free link to /signup', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: /sign up free/i });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/signup/);
});

test('landing page has Pricing link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /pricing/i }).click();
  await expect(page).toHaveURL(/\/pricing/);
});

test('landing page footer does NOT claim SOC 2', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await expect(footer).not.toContainText('SOC 2');
});
