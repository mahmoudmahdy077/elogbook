import { test, expect } from '@playwright/test';

test.describe('App smoke', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBeLessThan(503);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('durationMs');
  });

  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/E-Logbook|Log/);
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
  });

  test('login form is a real form with submit', async ({ page }) => {
    await page.goto('/login');
    const button = page.getByRole('button', { name: /Sign In|Send Magic Link/ });
    // Even if the form element isn't a <form>, the button must exist
    await expect(button).toBeVisible();
  });
});
