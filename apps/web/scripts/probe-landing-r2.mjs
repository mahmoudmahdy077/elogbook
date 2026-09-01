// Cycle 9 visual verification — full-page + viewport screenshots of the new landing.
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3277';
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox'] });

// Desktop 1280
const d = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const dp = await d.newPage();
await dp.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await dp.waitForTimeout(2000);
await dp.screenshot({ path: 'e2e/screenshots/landing-r2-desktop-full.png', fullPage: true });
await dp.screenshot({ path: 'e2e/screenshots/landing-r2-desktop-hero.png' });

// Interactions: hash lab
await dp.fill('#hashlab-mrn', '00-84-62');
await dp.waitForTimeout(700);
const digest = await dp.textContent('[data-testid="hash-output"]');
console.log('HASH_OUT:', (digest || '').trim().slice(0, 40));

// Demo two-click flow
await dp.click('[data-testid="approve-d1"]');
await dp.click('[data-testid="approve-d2"]');
await dp.waitForTimeout(900);
const artifactVisible = await dp.locator('[data-testid="demo-artifact"] p').first().textContent().catch(() => null);
console.log('ARTIFACT_HEADLINE:', artifactVisible);

// Vault expand
await dp.locator('[data-testid="trust-vault"] button').first().click();
await dp.waitForTimeout(400);

// Capture sheet via keyboard trigger (Shift+.)
await dp.keyboard.press('Shift+.');
await dp.waitForTimeout(800);
const sheetVisible = await dp.locator('[data-testid="capture-sheet"]').isVisible();
console.log('SHEET_VISIBLE:', sheetVisible);
if (sheetVisible) {
  await dp.screenshot({ path: 'e2e/screenshots/landing-r2-sheet.png' });
  // error state with invalid email? use valid test email then expect degrade msg on 500
  await dp.fill('[data-testid="capture-sheet"] input[type="email"]', 'cycle9-visual@test.local');
  await dp.click('[data-testid="capture-sheet"] button[type="submit"]');
  await dp.waitForTimeout(1500);
  const errText = await dp.locator('[data-testid="sle-error"]').textContent().catch(() => null);
  console.log('SHEET_ERROR_TEXT:', errText); // expected: retry copy due to expired SRK env
}
await d.close();

// Mobile 375
const m = await browser.newContext({ viewport: { width: 375, height: 667 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
const mp = await m.newPage();
await mp.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await mp.waitForTimeout(1500);
await mp.screenshot({ path: 'e2e/screenshots/landing-r2-mobile-full.png', fullPage: true });
console.log('MOBILE captured');
await m.close();

await browser.close();
console.log('DONE');
