#!/usr/bin/env node
// T20 UI baseline capture. Runs wherever Playwright browsers exist
// (CI e2e job installs chromium; locally: `pnpm --filter @elogbook/web
// exec playwright install chromium`). BASE_URL defaults to localhost:3000.
// Captures public pages at desktop + mobile viewports into
// docs/upgrade/evidence/T20/screens/. Authenticated screens need an E2E
// session (see apps/web/e2e/fixtures.ts) and are a follow-up, not faked.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs/upgrade/evidence/T20/screens');
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const PAGES = ['/', '/login', '/pricing', '/signup'];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
];

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('BLOCKED: playwright browsers unavailable (run `playwright install chromium` first)');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  for (const route of PAGES) {
    const name = `${route === '/' ? 'landing' : route.slice(1)}-${vp.name}.png`;
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.screenshot({ path: join(OUT, name) });
    console.log(`captured ${name}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`done: ${OUT}`);
