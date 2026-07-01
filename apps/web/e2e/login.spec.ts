import { test, expect } from '@playwright/test';

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders the email and password fields', async ({ page }) => {
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
  });

  test('shows the application name as heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /e-logbook/i })).toBeVisible();
  });

  test('has a working SSO navigation link', async ({ page }) => {
    const ssoLink = page.getByRole('link', { name: /sign in with sso/i });
    await expect(ssoLink).toBeVisible();
    await expect(ssoLink).toHaveAttribute('href', '/login/sso');
  });

  test('shows magic link hint when password is empty', async ({ page }) => {
    await expect(page.getByText(/leave blank to receive a magic link/i)).toBeVisible();
  });

  test('shows "Send magic link" text when password is empty', async ({ page }) => {
    await expect(page.getByRole('button', { name: /send magic link/i })).toBeVisible();
  });

  test('submit button is disabled when email is empty', async ({ page }) => {
    await expect(page.getByRole('button', { name: /send magic link/i })).toBeDisabled();
  });

  test('submit button becomes enabled when email is filled', async ({ page }) => {
    await page.locator('input#email').fill('doctor@hospital.org');
    await expect(page.getByRole('button', { name: /send magic link/i })).toBeEnabled();
  });

  test('shows "Sign in" text when both email and password are filled', async ({ page }) => {
    await page.locator('input#email').fill('doctor@hospital.org');
    await page.locator('input#password').fill('mypassword');
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('password field starts hidden and can be toggled', async ({ page }) => {
    const passwordInput = page.locator('input#password');
    await expect(passwordInput).toHaveAttribute('type', 'password');
    const toggle = page.getByRole('button', { name: /show password/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
  });

  test('password toggle label switches to hide after click', async ({ page }) => {
    await page.getByRole('button', { name: /show password/i }).click();
    await expect(page.getByRole('button', { name: /hide password/i })).toBeVisible();
  });

  test('has a "Forgot password?" button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible();
  });

  test('clicking "Forgot password?" shows reset form', async ({ page }) => {
    await page.locator('input#email').fill('doctor@hospital.org');
    await page.getByRole('button', { name: /forgot password/i }).click();
    await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
  });

  test('forgot password form shows "Back to sign in" button', async ({ page }) => {
    await page.locator('input#email').fill('doctor@hospital.org');
    await page.getByRole('button', { name: /forgot password/i }).click();
    await expect(page.getByRole('button', { name: /back to sign in/i })).toBeVisible();
  });

  test('can navigate back from forgot password to sign in', async ({ page }) => {
    await page.locator('input#email').fill('doctor@hospital.org');
    await page.getByRole('button', { name: /forgot password/i }).click();
    await page.getByRole('button', { name: /back to sign in/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
  });

  test('forgot password form shows the pre-filled email', async ({ page }) => {
    await page.locator('input#email').fill('doctor@hospital.org');
    await page.getByRole('button', { name: /forgot password/i }).click();
    await expect(page.getByText(/doctor@hospital\.org/i)).toBeVisible();
  });

  test('form fields have correct autocomplete attributes', async ({ page }) => {
    await expect(page.locator('input#email')).toHaveAttribute('autocomplete', 'email');
    await expect(page.locator('input#password')).toHaveAttribute('autocomplete', 'current-password');
  });

  test('form fields are connected to labels', async ({ page }) => {
    await expect(page.locator('label[for="email"]')).toHaveText(/email/i);
    await expect(page.locator('label[for="password"]')).toHaveText(/password/i);
  });

  test('email field shows placeholder', async ({ page }) => {
    await expect(page.locator('input#email')).toHaveAttribute('placeholder', /hospital\.org/i);
  });

  test('divider is visible between SSO and email form', async ({ page }) => {
    await expect(page.getByText(/or continue with email/i)).toBeVisible();
  });

  test('shows data handling policy notice at the bottom', async ({ page }) => {
    await expect(page.getByText(/data handling policy/i)).toBeVisible();
  });
});

test.describe('SSO login page', () => {
  test('renders slug input form when no tenant provided', async ({ page }) => {
    await page.goto('/login/sso');
    await expect(page.getByLabel(/institution slug/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /continue/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /sign in with sso/i })).toBeVisible();
  });

  test('slug input is required', async ({ page }) => {
    await page.goto('/login/sso');
    await expect(page.getByLabel(/institution slug/i)).toHaveAttribute('required', '');
  });

  test('slug input shows correct placeholder', async ({ page }) => {
    await page.goto('/login/sso');
    await expect(page.getByLabel(/institution slug/i)).toHaveAttribute('placeholder', /acme/i);
  });

  test('form has GET action to /login/sso', async ({ page }) => {
    await page.goto('/login/sso');
    const form = page.locator('form');
    await expect(form).toHaveAttribute('action', '/login/sso');
    await expect(form).toHaveAttribute('method', 'get');
  });

  test('shows app name and heading', async ({ page }) => {
    await page.goto('/login/sso');
    await expect(page.getByRole('heading', { name: /e-logbook/i })).toBeVisible();
  });

  test('shows instruction text', async ({ page }) => {
    await page.goto('/login/sso');
    await expect(page.getByText(/enter your institution slug/i)).toBeVisible();
  });

  test('forwards next query param as hidden field', async ({ page }) => {
    await page.goto('/login/sso?next=/dashboard');
    const hidden = page.locator('input[name="next"][type="hidden"]');
    await expect(hidden).toHaveValue('/dashboard');
  });

  test('defaults next to / when not provided', async ({ page }) => {
    await page.goto('/login/sso');
    const hidden = page.locator('input[name="next"][type="hidden"]');
    await expect(hidden).toHaveValue('/');
  });

  test('SSO Unavailable for unknown tenant slug', async ({ page }) => {
    await page.goto('/login/sso?tenant=nonexistent');
    await expect(page.getByText(/sso unavailable/i)).toBeVisible({ timeout: 15000 });
  });

  test('SSO Unavailable shows the attempted slug', async ({ page }) => {
    await page.goto('/login/sso?tenant=nonexistent');
    await expect(page.getByText(/nonexistent/i)).toBeVisible({ timeout: 15000 });
  });

  test('SSO Unavailable has a back link to /login', async ({ page }) => {
    await page.goto('/login/sso?tenant=nonexistent');
    const backLink = page.getByRole('link', { name: /back to sign.in/i });
    await expect(backLink).toBeVisible({ timeout: 15000 });
    await expect(backLink).toHaveAttribute('href', '/login');
  });
});

test.describe('Navigation between login and SSO', () => {
  test('SSO link on login page navigates to SSO page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /sign in with sso/i }).click();
    await expect(page).toHaveURL('/login/sso');
  });

  test('SSO Unavailable back link returns to login', async ({ page }) => {
    await page.goto('/login/sso?tenant=nonexistent');
    await page.getByRole('link', { name: /back to sign.in/i }).click({ timeout: 15000 });
    await expect(page).toHaveURL('/login');
  });
});
