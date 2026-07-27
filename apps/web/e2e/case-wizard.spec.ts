import { test, expect, MOCK_TENANT_SLUG, stubAuthSession } from '../e2e/fixtures';

test.describe('Case Wizard', () => {
  test('resident creates a case end-to-end (TEST-002)', async ({ page }) => {
    test.skip(process.env.NODE_ENV === 'production', 'demo accounts only in dev');

    await stubAuthSession(page);
    await page.goto(`/${MOCK_TENANT_SLUG}/cases/new`);
    await page.waitForLoadState('networkidle');

    // Step 1: Template — select a template card
    const template = page.locator('[aria-label*="General Surgery Log"]').first();
    await template.click();
    await page.getByText('Continue').click();

    // Step 2: Patient Info — toggle de-identified, fill age
    await page.locator('button[role="switch"]').click();
    await page.getByLabel('Patient age in years').fill('45');
    await page.getByText('Continue').click();

    // Step 3: Case Details — fill case date
    await page.getByLabel('Case date').fill('2026-07-21');
    await page.getByText('Continue').click();

    // Step 4: Review — submit
    await page.getByText('Submit Case').click();
    await page.getByText('Confirm & Submit').click();

    // Assert: success state
    await expect(page.getByText('Case Logged Successfully')).toBeVisible();
  });
});
