#!/usr/bin/env node
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
 * Auth: signs in through the Supabase Auth API (password grant) using creds
 * from the monorepo root .env (E2E_EMAIL / E2E_PASSWORD, defaulting to the
 * seeded demo resident) and seeds the sb-<ref>-auth-token cookie in
 * @supabase/ssr format — the same approach as e2e/fixtures.ts. A UI login is
 * not used because filling inputs before React hydrates races the controlled
 * state and leaves the submit button disabled forever.
 *
 * Exit code 0 = no overflow / JS errors found. 1 = issues found.
 */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
// Load the monorepo root .env (zero-dep parser, same as playwright.config.ts)
try {
  const envPath = new URL('../../../.env', import.meta.url);
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // .env missing — only public routes will render authenticated content
}
const EMAIL = process.env.LOGIN_EMAIL || process.env.E2E_EMAIL || 'resident@demo.com';
const PASSWORD = process.env.LOGIN_PASSWORD || process.env.E2E_PASSWORD || 'password123!';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? '';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
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
  }).catch(async (err) => {
    // A client-side navigation destroyed the execution context mid-check.
    // Let it settle and measure the page we actually landed on.
    if (!/Execution context|navigation/i.test(String(err))) throw err;
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    await page.waitForTimeout(1500);
    return page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      return {
        viewportW: window.innerWidth,
        docScrollWidth: doc.scrollWidth,
        bodyScrollWidth: body ? body.scrollWidth : 0,
        overflow: Math.max(
          doc.scrollWidth - window.innerWidth,
          body ? body.scrollWidth - window.innerWidth : 0,
        ),
        offenders: [],
        bodyChildren: body ? body.children.length : 0,
      };
    });
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

  // ---- Login as demo resident (Supabase Auth API + ssr cookie) ----
  console.log(`Signing in as ${EMAIL} via Supabase Auth API …`);
  if (!SUPABASE_URL || !ANON_KEY) {
    console.log('  ⚠ NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing — skipping auth (public routes only)');
  } else {
    const res = await page.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      data: { email: EMAIL, password: PASSWORD },
      headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      failOnStatusCode: false,
    });
    if (!res.ok()) {
      console.log(`  ⚠ auth API returned ${res.status()} — continuing unauthenticated`);
    } else {
      const session = await res.json();
      const authTokenValue = JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in ?? 3600,
        expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
        token_type: 'bearer',
        user: session.user,
      });
      await context.addCookies([
        {
          name: `sb-${PROJECT_REF}-auth-token`,
          value: 'base64-' + Buffer.from(authTokenValue).toString('base64'),
          url: BASE_URL,
          httpOnly: false,
          sameSite: 'Lax',
        },
      ]);
      console.log('  ✓ session cookie seeded');
    }
  }

  const results = [];
  let failures = 0;

  for (const route of ROUTES) {
    const url = `${BASE_URL}${route}`;
    for (const viewport of VIEWPORTS) {
      const label = `${viewport.name.padEnd(12)} ${route}`;
      try {
        // Client-side redirects (role gates, auth refresh) can interrupt the
        // outer page.goto and make Playwright throw ERR_ABORTED /
        // "interrupted by another navigation". These are harness races, not
        // layout bugs — retry, and if the redirect keeps fighting us, let it
        // settle and measure whatever page we actually landed on.
        let lastNavError;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
            lastNavError = null;
            break;
          } catch (err) {
            lastNavError = err;
            await page.waitForTimeout(1500);
          }
        }
        if (lastNavError) {
          try {
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
            await page.waitForTimeout(1500);
          } catch {
            // Nothing measurable landed — report the original error.
          }
        }
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
