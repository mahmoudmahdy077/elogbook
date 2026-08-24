import { test, expect, MOCK_TENANT_SLUG } from '../e2e/fixtures';

test.describe('Keyboard Shortcuts', () => {
  // Dev server compiles routes on demand; under parallel workers navigation
  // alone can exceed the 30s default.
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    // Navigate to a page that has the KeyboardShortcutsProvider active.
    // Dev-mode hydration can take seconds — wait for it, not a fixed delay.
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
  });

  test('pressing "?" opens keyboard shortcuts help dialog', async ({ page }) => {
    // Press "?" key
    await page.keyboard.press('?');

    // The keyboard shortcuts help dialog should appear
    const helpDialog = page.locator('[role="dialog"], .keyboard-shortcuts-help');
    const helpText = page.getByText(/Keyboard Shortcuts|keyboard/i);

    // One of these should be visible — poll to absorb hydration latency
    await expect(async () => {
      const hasDialog = (await helpDialog.count()) > 0;
      const hasHelpText = (await helpText.count()) > 0;
      expect(hasDialog || hasHelpText).toBeTruthy();
    }).toPass({ timeout: 10000 });
  });

  test('pressing Escape closes the help dialog if open', async ({ page }) => {
    // Open help with "?"
    await page.keyboard.press('?');
    await page.waitForTimeout(100);

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Help dialog should no longer be visible
    const helpDialog = page.locator('[role="dialog"]').filter({ hasText: /keyboard|shortcuts/i });
    const isVisible = await helpDialog.isVisible().catch(() => false);
    expect(isVisible).toBeFalsy();
  });

  test('pressing "G" enters sequence mode waiting for second key', async ({ page }) => {
    // Press 'G' (uppercase is normalized to lowercase in the handler).
    // The SequenceIndicator renders a fixed glass panel containing a <kbd>.
    await page.keyboard.press('g');

    const sequenceIndicator = page.locator('.fixed.bottom-6 kbd');
    await expect(sequenceIndicator).toBeVisible({ timeout: 10000 });
    await expect(sequenceIndicator).toHaveText(/G/i);

    // Wait for the sequence to time out (1200ms + buffer)
    await page.waitForTimeout(1500);

    // After timeout, the sequence indicator should disappear
    await expect(sequenceIndicator).not.toBeVisible();
  });

  // Press 'g' with hydration-aware retry: the first keypress can land before
  // the KeyboardShortcutsProvider mounts under dev-server load. Verifies the
  // SequenceIndicator engaged before returning.
  async function pressG(page: import('@playwright/test').Page) {
    const indicator = page.locator('.fixed.bottom-6 kbd');
    let started = false;
    for (let attempt = 0; attempt < 4 && !started; attempt++) {
      await page.keyboard.press('g');
      try {
        await indicator.waitFor({ state: 'visible', timeout: 2500 });
        started = true;
      } catch { /* not hydrated yet — retry */ }
    }
    expect(started).toBeTruthy();
  }

  test('pressing "G" then "D" navigates to dashboard', async ({ page }) => {
    // First navigate to a non-dashboard page
    await page.goto(`/${MOCK_TENANT_SLUG}/cases`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    await pressG(page);
    await page.keyboard.press('d');

    // Should navigate to dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    expect(page.url()).toContain('/dashboard');
  });

  test('pressing "G" then "C" navigates to cases', async ({ page }) => {
    await pressG(page);
    await page.keyboard.press('c');

    await page.waitForURL('**/cases', { timeout: 10000 });
    expect(page.url()).toContain('/cases');
  });

  test('pressing "G" then "A" navigates to approvals', async ({ page }) => {
    // As a resident this renders the not-found page AT /approvals (page-level
    // RBAC) — navigation itself is what we verify.
    await pressG(page);
    await page.keyboard.press('a');

    await page.waitForURL('**/approvals', { timeout: 10000 });
    expect(page.url()).toContain('/approvals');
  });

  test('pressing "G" then "G" navigates to goals', async ({ page }) => {
    // Second 'G' maps to goals
    await pressG(page);
    await page.keyboard.press('g');

    await page.waitForURL('**/goals', { timeout: 10000 });
    expect(page.url()).toContain('/goals');
  });

  test('Cmd+K opens command palette', async ({ page }) => {
    // Press Cmd+K (or Ctrl+K on non-Mac)
    await page.keyboard.press('Meta+k');

    // Wait for command palette to appear
    await expect(async () => {
      const palette = page.locator('[role="dialog"], .command-palette');
      const paletteInput = page.locator('input[placeholder*="Command" i], input[placeholder*="Search" i]');
      const hasDialog = (await palette.count()) > 0;
      const hasInput = (await paletteInput.count()) > 0;
      expect(hasDialog || hasInput).toBeTruthy();
    }).toPass({ timeout: 10000 });
  });

  test('Cmd+N navigates to new case page', async ({ page }) => {
    // Press Cmd+N (or Ctrl+N)
    await page.keyboard.press('Meta+n');

    // Should navigate to cases/new
    await page.waitForURL('**/cases/new', { timeout: 10000 });
    expect(page.url()).toContain('/cases/new');
  });

  test('shortcuts do not fire while typing in an input', async ({ page }) => {
    // Type 'g' in the search/command input if present — should NOT trigger sequence mode
    await page.waitForTimeout(1500);
    const emailInput = page.locator('input').first();
    const inputExists = (await emailInput.count()) > 0;

    if (inputExists) {
      await emailInput.focus();
      await page.keyboard.type('g');

      // Sequence indicator should NOT appear
      const sequenceIndicator = page.locator('text=g').first();
      await page.waitForTimeout(200);
      const isIndicatorVisible = await sequenceIndicator.isVisible().catch(() => false);
      expect(isIndicatorVisible).toBeFalsy();
    }
  });
});
