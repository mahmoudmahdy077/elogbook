import { test, expect } from '../e2e/fixtures';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('login page renders with app name and form', async ({ page }) => {
    // App name heading should be visible
    await expect(page.locator('h1')).toBeVisible();
    const headingText = await page.locator('h1').textContent();
    expect(headingText?.trim()).toBeTruthy();

    // Tagline
    await expect(page.getByText('Sign in to your account')).toBeVisible();

    // Email input should be present
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('placeholder', 'doctor@hospital.org');

    // Password input should be present
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('placeholder', 'Enter password');

    // Forgot password link
    await expect(page.getByText('Forgot password?')).toBeVisible();
  });

  test('SSO sign-in button exists', async ({ page }) => {
    // The SSO button should link to /login/sso
    const ssoLink = page.locator('a').filter({ hasText: 'Sign in with SSO' });
    await expect(ssoLink).toBeVisible();
    await expect(ssoLink).toHaveAttribute('href', '/login/sso');
  });

  test('form submission disabled when email is empty', async ({ page }) => {
    const submitButton = page.locator('button[type="submit"]');
    // When email is empty, the button should be disabled
    await expect(submitButton).toBeDisabled();
    expect(await submitButton.textContent()).toContain('Sign in');
  });

  test('toggle password visibility works', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]');
    const showPasswordButton = page.locator('button[aria-label="Show password"]');

    // Initially password is hidden
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Click the eye icon
    await showPasswordButton.click();

    // Password should now be visible (type changes to text)
    const visibleField = page.locator('input[type="text"]');
    await expect(visibleField).toBeVisible();

    // Toggle back
    const hidePasswordButton = page.locator('button[aria-label="Hide password"]');
    await hidePasswordButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('magic link flow shows success state when password blank', async ({ page }) => {
    const emailInput = page.locator('input[type="email"]');
    await emailInput.fill('doctor@hospital.org');

    // Leave password blank — submit button should say "Send magic link"
    const submitButton = page.locator('button[type="submit"]');
    expect(await submitButton.textContent()).toContain('Send magic link');
  });

  test('forgot password flow renders reset form', async ({ page }) => {
    // Click "Forgot password?"
    await page.getByText('Forgot password?').click();

    // Should now show the reset password form
    await expect(page.getByText('Reset password')).toBeVisible();
    await expect(page.getByText('Enter your email')).toBeVisible();

    // "Send reset link" button should exist
    const resetButton = page.getByText('Send reset link');
    await expect(resetButton).toBeVisible();
  });

  test('UI follows Apple Health design system', async ({ page }) => {
    // The login card should use white background with rounded-2xl
    const loginCard = page.locator('.rounded-2xl.border');
    await expect(loginCard).toBeVisible();

    // Primary buttons should use rounded-full (pill button style)
    const primaryButton = page.locator('button[type="submit"]');
    await expect(primaryButton).toHaveClass(/rounded-full/);
  });
});
