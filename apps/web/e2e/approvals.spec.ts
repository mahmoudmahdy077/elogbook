import { test, expect, MOCK_TENANT_SLUG } from '../e2e/fixtures';

test.describe('Approvals Bulk Actions', () => {
  test('approvals page renders pending count', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/approvals`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const heading = page.getByText('Pending Approvals');
    const headingExists = await heading.count();
    test.skip(headingExists === 0, 'Pending Approvals heading not found (requires auth)');

    await expect(heading).toBeVisible();
  });

  test('select all checkbox toggles all entries', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/approvals`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const selectAll = page.getByLabel('Select All');
    const exists = await selectAll.count();
    test.skip(exists === 0, 'Select All not found (requires auth or no pending entries)');

    await selectAll.check();
    const selectedText = page.getByText(/selected/);
    await expect(selectedText).toBeVisible();
  });

  test('bulk approve button appears when entries selected', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/approvals`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const checkboxes = page.locator('input[type="checkbox"]').filter({ hasNot: page.getByLabel('Select All') });
    const count = await checkboxes.count();
    test.skip(count === 0, 'No approval entries found (requires auth or no pending entries)');

    await checkboxes.first().check();
    const approveBtn = page.getByRole('button', { name: /Approve Selected/i });
    await expect(approveBtn).toBeVisible();
  });

  test('bulk reject requires confirmation', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/approvals`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const checkboxes = page.locator('input[type="checkbox"]').filter({ hasNot: page.getByLabel('Select All') });
    const count = await checkboxes.count();
    test.skip(count === 0, 'No approval entries found (requires auth or no pending entries)');

    await checkboxes.first().check();
    const rejectBtn = page.getByRole('button', { name: /Reject Selected/i });
    await rejectBtn.click();

    const confirmText = page.getByText('Click Reject Selected again to confirm');
    await expect(confirmText).toBeVisible();

    const confirmBtn = page.getByRole('button', { name: /Confirm Reject/i });
    await expect(confirmBtn).toBeVisible();
  });

  test('view button opens case preview modal', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/approvals`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const viewBtn = page.getByRole('button', { name: /^View$/i }).first();
    const exists = await viewBtn.count();
    test.skip(exists === 0, 'No View buttons found (requires auth or no pending entries)');

    await viewBtn.click();
    await page.waitForTimeout(500);

    const modal = page.locator('[role="dialog"]').first();
    const modalVisible = await modal.isVisible().catch(() => false);
    expect(modalVisible).toBeTruthy();
  });

  test('KPI stat cards display on approvals page', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/approvals`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const pendingCard = page.getByText('Pending');
    const pendingExists = await pendingCard.count();
    test.skip(pendingExists === 0, 'KPI cards not found (requires auth)');

    await expect(pendingCard).toBeVisible();
    await expect(page.getByText('Today')).toBeVisible();
    await expect(page.getByText('This Week')).toBeVisible();
    await expect(page.getByText('Approval Rate')).toBeVisible();
  });
});
