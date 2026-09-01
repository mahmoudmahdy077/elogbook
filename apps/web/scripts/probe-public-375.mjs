// Viewport-only captures of logged-out public pages at 375px
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3100';
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
const page = await ctx.newPage();
for (const route of ['/login', '/pricing', '/signup']) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2500);
  const url = page.url().replace(BASE, '');
  await page.screenshot({ path: `e2e/screenshots/responsive/pub-${route.replace(/\//g, '_') || 'root'}-375.png` });
  console.log(route, '->', url, 'captured (viewport-only)');
}
await browser.close();
