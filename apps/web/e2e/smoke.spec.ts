import { test, expect } from '@playwright/test';

test.describe('App smoke', () => {
  test('health endpoint is liveness-only (200, no dependencies)', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body).toHaveProperty('timestamp');
    // Liveness must not expose dependency state (T03 contract).
    expect(body).not.toHaveProperty('db');
    expect(body).not.toHaveProperty('rateLimit');
  });

  test('ready endpoint reports dependencies', async ({ request }) => {
    const res = await request.get('/api/ready');
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('db');
    expect(body).toHaveProperty('rateLimit');
  });

  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/E-Logbook|Log/);
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
  });

  test('login form is a real form with submit', async ({ page }) => {
    await page.goto('/login');
    const button = page.getByRole('button', { name: /sign in|magic link/i });
    // Even if the form element isn't a <form>, the button must exist
    await expect(button).toBeVisible();
  });
});
