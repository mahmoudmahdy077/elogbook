// Responsive audit probe: viewport sweep over public + authenticated routes.
// Checks per breakpoint: horizontal overflow, overflowing elements, tap-target sizes (mobile only).
// Usage: node scripts/probe-responsive.mjs   (requires dev server on 127.0.0.1:3100)
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = 'http://127.0.0.1:3100';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const REF = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)[1];

// [route, needsAuth]
const ROUTES = [
  ['/', false],
  ['/login', false],
  ['/signup', false],
  ['/pricing', false],
  ['/demo/dashboard', true],
  ['/demo/cases', true],
  ['/demo/rotations', true],
  ['/demo/settings', true],
];
const VIEWPORTS = [
  [375, 667],
  [768, 1024],
  [1440, 900],
];
// Optional narrowing: PROBE_ROUTES=/pricing,/login PROBE_VPS=375
const ROUTE_FILTER = (process.env.PROBE_ROUTES || '').split(',').filter(Boolean);
const VP_FILTER = (process.env.PROBE_VPS || '').split(',').filter(Boolean).map(Number);
const routes = ROUTE_FILTER.length ? ROUTES.filter(([r]) => ROUTE_FILTER.includes(r)) : ROUTES;
const viewports = VP_FILTER.length ? VIEWPORTS.filter(([w]) => VP_FILTER.includes(w)) : VIEWPORTS;

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox'] });

// Authenticated context via Supabase password grant + session cookie (pattern: scripts/probe-auth.mjs)
const ctx = await browser.newContext({ viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] } });
if (SUPABASE_URL && ANON) {
  const res = await ctx.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    data: { email: 'resident@demo.com', password: 'password123!' },
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
  }).catch(() => null);
  if (res && res.ok()) {
    const session = await res.json();
    const tokenValue = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: session.user,
    });
    await ctx.addCookies([
      { name: `sb-${REF}-auth-token`, value: 'base64-' + Buffer.from(tokenValue).toString('base64'), url: BASE, httpOnly: false, sameSite: 'Lax' },
    ]);
    console.log('AUTH: session cookie set');
  } else {
    console.log('AUTH: password grant failed (' + (res ? res.status() : 'network error') + ') — authed routes will redirect');
  }
} else {
  console.log('AUTH: no Supabase env vars — authed routes will redirect');
}

const problems = [];
let shotDir = 'e2e/screenshots/responsive';

for (const vp of viewports) {
  const [width, height] = vp;
  for (const [route] of routes) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height });
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(2200);
      const url = page.url();

      const audit = await page.evaluate(() => {
        const vw = window.innerWidth;
        const doc = document.documentElement;
        const hOver = doc.scrollWidth - doc.clientWidth;
        const overflows = [];
        if (hOver > 2) {
          for (const el of document.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > vw + 1) {
              let s = el.tagName.toLowerCase();
              if (el.id) s += '#' + el.id;
              else if (el.className && typeof el.className === 'string' && el.className.trim())
                s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
              overflows.push(`${s} ${Math.round(r.width)}x${Math.round(r.height)} right=${Math.round(r.right)}`);
              if (overflows.length >= 5) break;
            }
          }
        }
        // Tiny tap targets — mobile viewport only, visible interactive elements
        const tiny = [];
        if (vw <= 400) {
          for (const el of document.querySelectorAll('a[href], button')) {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            const invisible = cs.display === 'none' || cs.visibility === 'hidden' ||
              (cs.clip === 'rect(0px, 0px, 0px, 0px)' && (cs.position === 'absolute'));
            if (invisible || r.width === 0 || r.height === 0) continue;
            // sr-only links are screen-reader only (visible on focus) — not tap targets
            if (typeof el.className === 'string' && el.className.includes('sr-only')) continue;
            // skip icon-only controls that expose an accessible label
            const iconOnlyOk = (el.getAttribute('aria-label') || el.getAttribute('title') ||
              (el.getAttribute('aria-labelledby') != null));
            // height >= 44 (project convention); width >= 24 (WCAG 2.5.8 AA) — inline text links exempt from 44w
            const wOK = r.width >= 24, hOK = r.height >= 44;
            if (!(wOK && hOK) && !iconOnlyOk) {
              let label = (el.textContent || '').trim().slice(0, 24);
              let s = el.tagName.toLowerCase();
              if (el.className && typeof el.className === 'string')
                s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
              tiny.push(`${s} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
              if (tiny.length >= 6) break;
            }
          }
        }
        return { hOver, overflows, tiny };
      });

      const shots = [];
      if (audit.hOver > 2 || audit.tiny.length > 0) {
        const name = `${route.replace(/\//g, '_') || 'root'}-${width}.png`;
        await page.screenshot({ path: `${shotDir}/${name}`, fullPage: true }).catch(() => {});
        shots.push(`screenshot:${shotDir}/${name}`);
      }
      const status = audit.hOver > 2 ? `HOVERFLOW+${audit.hOver}px` : 'ok';
      const flag = audit.tiny.length > 0 ? ` TINY(${audit.tiny.length})` : '';
      console.log(JSON.stringify({ w: width, route, status, flag: flag || '', finalUrl: url.replace(BASE, ''), shots }));
      if (audit.hOver > 2) problems.push({ w: width, route, type: 'horizontal-overflow', px: audit.hOver, els: audit.overflows });
      if (audit.tiny.length > 0) problems.push({ w: width, route, type: 'tiny-tap-targets', items: audit.tiny.slice(0, 6) });
    } catch (e) {
      console.log(JSON.stringify({ w: width, route, status: 'ERROR', err: String(e).slice(0, 140) }));
    }
    await page.close();
  }
}

console.log('\n=== PROBLEM SUMMARY ===');
console.log(problems.length === 0 ? 'NONE — all clean' : JSON.stringify(problems, null, 1));
await browser.close();
