#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Responsive sweep — verifies every web route at 375 / 768 / 1440 viewports.
 *
 * Checks per (route × viewport):
 *   1. Horizontal overflow (scrollWidth > clientWidth) + top offending elements
 *   2. JavaScript page errors + console errors (filtered for known benign noise)
 *   3. Final URL after redirects (auth/role redirects are recorded, not failures)
 *
 * Usage (requires the dev server running, e.g. `pnpm dev -p 3100`):
 *   BASE_URL=http://127.0.0.1:3100 node scripts/responsive-sweep.mjs
 *   LOGIN_EMAIL / LOGIN_PASSWORD env vars override demo credentials.
 *
 * Exit code 0 = no overflow / JS errors found. 1 = issues found.
 */
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const EMAIL = process.env.LOGIN_EMAIL || 'resident@demo.com';
const PASSWORD = process.env.LOGIN_PASSWORD || 'password123!';
// Production redirects authenticated users to /demo/dashboard — the demo tenant slug.
const TENANT = 'demo';

const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

// Optional partial sweep: ROUTES_ONLY="route1,route2" restricts the run to
// matching route prefixes (resume after an interrupted sweep, e.g. OOM kill).
let ROUTES = [
  // Public
  '/',
  '/login',
  '/login/sso',
  '/signup',
  '/pricing',
  '/contact',
  '/api-docs',
  '/onboarding',
  '/mfa/enroll',
  '/mfa/verify',
  // Authenticated (tenant-scoped)
  `/${TENANT}/dashboard`,
  `/${TENANT}/cases`,
  `/${TENANT}/cases/new`,
  `/${TENANT}/cases/demo-case`,
  `/${TENANT}/rotations`,
  `/${TENANT}/evaluations`,
  `/${TENANT}/analytics`,
  `/${TENANT}/compliance`,
  `/${TENANT}/reports`,
  `/${TENANT}/reports/duty-hours`,
  `/${TENANT}/goals`,
  `/${TENANT}/milestones`,
  `/${TENANT}/approvals`,
  `/${TENANT}/audit`,
  `/${TENANT}/settings`,
  `/${TENANT}/consent`,
  `/${TENANT}/evaluate`,
  `/${TENANT}/evaluate/resident/demo-resident`,
  `/${TENANT}/resident/evaluations`,
  `/${TENANT}/resident/duty-hours`,
  `/${TENANT}/billing`,
  // Admin (role-gated — whatever renders is still checked)
  `/${TENANT}/admin`,
  `/${TENANT}/admin/overview`,
  `/${TENANT}/admin/sso`,
  `/${TENANT}/admin/webhooks`,
  `/${TENANT}/admin/scim`,
  `/${TENANT}/admin/retention`,
];
if (process.env.ROUTES_ONLY) {
  const only = process.env.ROUTES_ONLY.split(',').map((s) => s.trim()).filter(Boolean);
  ROUTES = ROUTES.filter((r) => only.some((p) => r.includes(p)));
  // eslint-disable-next-line no-console
  console.log(`ROUTES_ONLY filter active — checking ${ROUTES.length} routes`);
}

// Console messages that are expected / benign in this app.
const BENIGN_MSG = [
  /favicon/i,
  /net::ERR_ABORTED/,
  /net::ERR_CONNECTION/,
  /Failed to load resource/i,
  /Download the React DevTools/i,
  /supabase.*realtime/i,
  /websocket.*(close|error)/i,
  /Sentry.*(Rate limit|rate limit)/i,
  /ResizeObserver loop/i,
  /[Mm]etadata.*already exists/i,
];

function isBenign(text) {
  return BENIGN_MSG.some((re) => re.test(text));
}

async function checkPage(page, viewport) {
  const issues = [];
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // Give client JS a beat to settle (charts, hydration, fetch callbacks).
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const viewportW = window.innerWidth;
    const overflow = Math.max(
      doc.scrollWidth - viewportW,
      body ? body.scrollWidth - viewportW : 0,
    );

    // Find the elements that stick out past the right edge.
    const offenders = [];
    if (overflow > 1) {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.right > viewportW + 2 && r.width > 4 && r.height > 4) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            id: el.id ? `#${el.id}` : '',
            cls: (el.className && typeof el.className === 'string')
              ? el.className.split(/\s+/).slice(0, 4).join('.')
              : '',
            right: Math.round(r.right),
            width: Math.round(r.width),
            text: (el.textContent || '').trim().slice(0, 40),
          });
          if (offenders.length >= 6) break;
        }
      }
    }
    return {
      viewportW,
      docScrollWidth: doc.scrollWidth,
      bodyScrollWidth: body ? body.scrollWidth : 0,
      overflow,
      offenders,
      bodyChildren: body ? body.children.length : 0,
    };
  });

  if (metrics.overflow > 1) {
    issues.push({
      type: 'OVERFLOW',
      detail: `doc=${metrics.docScrollWidth} body=${metrics.bodyScrollWidth} vs viewport=${metrics.viewportW} (+${metrics.overflow}px)`,
      offenders: metrics.offenders,
    });
  }

  const realPageErrors = pageErrors.filter((e) => !isBenign(e));
  const realConsoleErrors = consoleErrors.filter((e) => !isBenign(e));

  if (realPageErrors.length) {
    issues.push({ type: 'PAGE_ERROR', detail: realPageErrors.slice(0, 3).join(' | ') });
  }
  if (realConsoleErrors.length) {
    issues.push({ type: 'CONSOLE_ERROR', detail: realConsoleErrors.slice(0, 3).join(' | ') });
  }

  return { issues, finalUrl: page.url() };
}

async function main() {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox', '--js-flags=--max-old-space-size=384'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  // ---- Login as demo resident ----
  console.log(`Logging in as ${EMAIL} …`);
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(800);

  const fillAndSubmit = async () => {
    await page.fill('input#email', EMAIL).catch(() => {});
    await page.fill('input#password', PASSWORD).catch(() => {});
    // The submit button only enables after React hydrates and picks up the
    // filled values (disabled={!email || loading}) — wait for it so we never
    // click a dead server-rendered button.
    await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 45000 });
    await page.click('button[type="submit"]');
  };

  try {
    await fillAndSubmit();
  } catch {
    // First paint may have failed to hydrate (slow dev compile) — reload once.
    console.log('  ⚠ submit stayed disabled — reloading to re-hydrate');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(800);
    await fillAndSubmit();
  }

  try {
    await page.waitForURL(/\/dashboard/, { timeout: 60000 });
    console.log('  ✓ logged in, landed at', page.url());
  } catch {
    console.log('  ⚠ login did not redirect to a dashboard. Final URL:', page.url());
    console.log('    (continuing sweep — unauthenticated routes still verified)');
  }

  const results = [];
  let failures = 0;

  for (const route of ROUTES) {
    const url = `${BASE_URL}${route}`;
    for (const viewport of VIEWPORTS) {
      const label = `${viewport.name.padEnd(12)} ${route}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        const { issues, finalUrl } = await checkPage(page, viewport);
        const row = { route, viewport: viewport.name, issues, finalUrl };
        results.push(row);
        if (issues.length) {
          failures++;
          console.log(`  ✗ ${label}  → ${finalUrl.replace(BASE_URL, '')}`);
          for (const i of issues) {
            console.log(`      ${i.type}: ${i.detail}`);
            if (i.offenders?.length) {
              for (const o of i.offenders) {
                console.log(`        <${o.tag}${o.id} .${o.cls}> right=${o.right} w=${o.width} "${o.text}"`);
              }
            }
          }
        } else {
          console.log(`  ✓ ${label}`);
        }
      } catch (err) {
        failures++;
        results.push({ route, viewport: viewport.name, issues: [{ type: 'NAV_ERROR', detail: String(err).slice(0, 200) }], finalUrl: '' });
        console.log(`  ✗ ${label}  NAV ERROR: ${String(err).slice(0, 160)}`);
      }
    }
  }

  await browser.close();

  // ---- Summary ----
  console.log('\n================ SUMMARY ================');
  const total = ROUTES.length * VIEWPORTS.length;
  console.log(`Routes: ${ROUTES.length} × viewports: ${VIEWPORTS.length} = ${total} checks`);
  console.log(`Failures: ${failures}  Passed: ${total - failures}`);

  const overflowCount = results.filter((r) => r.issues.some((i) => i.type === 'OVERFLOW')).length;
  const jsErrorCount = results.filter((r) => r.issues.some((i) => i.type === 'PAGE_ERROR' || i.type === 'CONSOLE_ERROR')).length;
  const navErrorCount = results.filter((r) => r.issues.some((i) => i.type === 'NAV_ERROR')).length;
  console.log(`Overflow issues: ${overflowCount} | JS errors: ${jsErrorCount} | Nav errors: ${navErrorCount}`);

  if (overflowCount) {
    console.log('\nRoutes with horizontal overflow:');
    for (const r of results) {
      const ov = r.issues.find((i) => i.type === 'OVERFLOW');
      if (ov) console.log(`  - ${r.route} @ ${r.viewport}: ${ov.detail}`);
    }
  }

  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
