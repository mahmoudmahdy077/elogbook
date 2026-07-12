import { test, expect, MOCK_TENANT_SLUG } from '../e2e/fixtures';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a page that has the KeyboardShortcutsProvider active
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    // Wait for the shortcuts context to initialize
    await page.waitForTimeout(300);
  });

  test('pressing "?" opens keyboard shortcuts help dialog', async ({ page }) => {
    // Press "?" key
    await page.keyboard.press('?');

    // The keyboard shortcuts help dialog should appear
    // Look for the ShortcutsRenderer content or help dialog
    // The help dialog is rendered by KeyboardShortcutsHelp component
    const helpDialog = page.locator('[role="dialog"], .keyboard-shortcuts-help');
    const helpText = page.getByText(/Keyboard Shortcuts|keyboard/i);

    // One of these should be visible
    const hasDialog = (await helpDialog.count()) > 0;
    const hasHelpText = (await helpText.count()) > 0;
    expect(hasDialog || hasHelpText).toBeTruthy();
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
    // Press 'G' (uppercase is normalized to lowercase in the handler)
    await page.keyboard.press('g');

    // The sequence indicator component should appear
    const sequenceIndicator = page.locator('text=g').first();
    await expect(sequenceIndicator).toBeVisible();

    // Wait for the sequence to time out (1200ms + buffer)
    await page.waitForTimeout(1500);

    // After timeout, the sequence indicator should disappear
    await expect(sequenceIndicator).not.toBeVisible();
  });

  test('pressing "G" then "D" navigates to dashboard', async ({ page }) => {
    // First navigate to a non-dashboard page
    await page.goto(`/${MOCK_TENANT_SLUG}/cases`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(300);

    // Press 'G' then 'D' to navigate to dashboard
    await page.keyboard.press('g');
    await page.waitForTimeout(100);
    await page.keyboard.press('d');

    // Should navigate to dashboard
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/dashboard');
  });

  test('pressing "G" then "C" navigates to cases', async ({ page }) => {
    // Press 'G' then 'C'
    await page.keyboard.press('g');
    await page.waitForTimeout(100);
    await page.keyboard.press('c');

    // Should navigate to cases
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/cases');
  });

  test('pressing "G" then "A" navigates to approvals', async ({ page }) => {
    // Press 'G' then 'A'
    await page.keyboard.press('g');
    await page.waitForTimeout(100);
    await page.keyboard.press('a');

    // Should navigate to approvals
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/approvals');
  });

  test('pressing "G" then "G" navigates to goals', async ({ page }) => {
    // Press 'G' then 'G' (second 'G' maps to goals)
    await page.keyboard.press('g');
    await page.waitForTimeout(100);
    await page.keyboard.press('g');

    // Should navigate to goals
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/goals');
  });

  test('Cmd+K opens command palette', async ({ page }) => {
    // Press Cmd+K (or Ctrl+K on non-Mac)
    await page.keyboard.press('Meta+k');

    // Wait for command palette to appear
    await page.waitForTimeout(300);

    // The command palette should be visible
    const palette = page.locator('[role="dialog"], .command-palette');
    const paletteInput = page.locator('input[placeholder*="Command" i], input[placeholder*="Search" i]');

    const hasDialog = (await palette.count()) > 0;
    const hasInput = (await paletteInput.count()) > 0;
    expect(hasDialog || hasInput).toBeTruthy();
  });

  test('Cmd+N navigates to new case page', async ({ page }) => {
    // Press Cmd+N (or Ctrl+N)
    await page.keyboard.press('Meta+n');

    // Should navigate to cases/new
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/cases/new');
  });

  test('shortcuts do not fire while typing in an input', async ({ page }) => {
    // Type 'g' in an input field — should NOT trigger sequence mode
    // First, let's click on any input or contenteditable area
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
