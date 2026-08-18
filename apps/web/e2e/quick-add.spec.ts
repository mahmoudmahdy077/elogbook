import { test, expect, MOCK_TENANT_SLUG } from '../e2e/fixtures';

test.describe('Quick Add Case', () => {
  test('click FAB opens quick add slide-over', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const fab = page.getByRole('button', { name: /Quick add case/i });
    const fabExists = await fab.count();
    test.skip(fabExists === 0, 'FAB not visible (requires auth)');

    await fab.click();
    const slideOver = page.getByText('Quick Add Case');
    await expect(slideOver).toBeVisible();
  });

  test('quick add form shows template selector', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const fab = page.getByRole('button', { name: /Quick add case/i });
    const fabExists = await fab.count();
    test.skip(fabExists === 0, 'FAB not visible (requires auth)');

    await fab.click();
    const templateSelect = page.getByLabel('Select template');
    await expect(templateSelect).toBeVisible();
  });

  test('quick add form validates required template', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const fab = page.getByRole('button', { name: /Quick add case/i });
    const fabExists = await fab.count();
    test.skip(fabExists === 0, 'FAB not visible (requires auth)');

    await fab.click();
    await page.getByRole('button', { name: /Save & Close/i }).click();
    const error = page.getByText('Please select a template.');
    await expect(error).toBeVisible();
  });

  test('quick add form closes on Escape', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const fab = page.getByRole('button', { name: /Quick add case/i });
    const fabExists = await fab.count();
    test.skip(fabExists === 0, 'FAB not visible (requires auth)');

    await fab.click();
    await expect(page.getByText('Quick Add Case')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Quick Add Case')).not.toBeVisible();
  });

  test('quick add form closes on close button click', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const fab = page.getByRole('button', { name: /Quick add case/i });
    const fabExists = await fab.count();
    test.skip(fabExists === 0, 'FAB not visible (requires auth)');

    await fab.click();
    await expect(page.getByText('Quick Add Case')).toBeVisible();
    await page.getByRole('button', { name: /Close/i }).click();
    await expect(page.getByText('Quick Add Case')).not.toBeVisible();
  });

  test('de-identify toggle shows/hides patient fields', async ({ page }) => {
    await page.goto(`/${MOCK_TENANT_SLUG}/dashboard`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const fab = page.getByRole('button', { name: /Quick add case/i });
    const fabExists = await fab.count();
    test.skip(fabExists === 0, 'FAB not visible (requires auth)');

    await fab.click();
    const deidentifyCheckbox = page.getByLabel('De-identify patient');
    await expect(deidentifyCheckbox).toBeChecked();
    const mrnInput = page.getByLabel('Patient MRN');
    await expect(mrnInput).not.toBeVisible();
    await deidentifyCheckbox.uncheck();
    await expect(mrnInput).toBeVisible();
  });
});
