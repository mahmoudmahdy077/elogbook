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

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox'] });
const context = await browser.newContext();
const res = await context.request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  data: { email: 'resident@demo.com', password: 'password123!' },
  headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
});
const session = await res.json();
const tokenValue = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: session.user,
});
await context.addCookies([
  { name: `sb-${REF}-auth-token`, value: 'base64-' + Buffer.from(tokenValue).toString('base64'), url: BASE, httpOnly: false, sameSite: 'Lax' },
]);
const page = await context.newPage();
for (const route of ['/demo/cases', '/demo/rotations', '/demo/settings', '/demo/analytics']) {
  const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);
  const notFound = await page.evaluate(() => document.body.innerText.includes("doesn't exist"));
  console.log(route, '→ HTTP', resp.status(), notFound ? 'NOT_FOUND_PAGE' : 'renders');
}
await browser.close();
