import { test, expect } from '@playwright/test';

test('login page is readable in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  const bodyColor = await page.locator('body').evaluate((el) => getComputedStyle(el).color);
  const bgColor = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bodyColor).not.toBe(bgColor);
});
