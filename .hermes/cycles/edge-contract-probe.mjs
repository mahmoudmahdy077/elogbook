// Edge-function fleet contract probe v2 — corrected contracts.
// list-invoices: GET-only (POST must 405); authed GET must not hang / <500 (503 billing-unconfigured OK).
// generate-pdf: POST {case_ids[],resident_name,tenant} -> %PDF magic; malformed -> 400.
// scim: intentionally disabled -> 503 expected on any auth state.
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); };

async function login(email) {
  return fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: JSON.stringify({ email, password: 'password123!' }), signal: AbortSignal.timeout(30000),
  }).then(r => r.json());
}

const dir = await login('director@demo.com');
ok('login-director', !!dir.access_token);
const res_ = await login('resident@demo.com');
ok('login-resident', !!res_.access_token);
const H = { apikey: KEY, Authorization: `Bearer ${dir.access_token}`, 'Content-Type': 'application/json' };
const RH = { apikey: KEY, Authorization: `Bearer ${res_.access_token}`, 'Content-Type': 'application/json' };

let cid = null;
try {
  const prof = (await fetch(`${SB}/rest/v1/profiles?user_id=eq.${res_.user.id}&select=id`, { headers: RH }).then(r => r.json()))[0];
  const cases = await fetch(`${SB}/rest/v1/case_entries?select=id&resident_id=eq.${prof.id}&status=eq.approved&deleted_at=is.null&limit=1`, { headers: RH }).then(r => r.json());
  cid = cases[0]?.id || null;
} catch {}
ok('fixture-approved-case', !!cid, cid?.slice(0, 8) || 'none');

const FLEET = ['ai-gap-analysis', 'ai-insights', 'ai-quality', 'create-checkout', 'create-portal-session', 'webads-export'];
for (const fn of FLEET) {
  try {
    const r = await fetch(`${SB}/functions/v1/${fn}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(25000) });
    ok(`${fn}::noauth-rejected`, [401, 403].includes(r.status), `status=${r.status}`);
  } catch (e) { ok(`${fn}::noauth-rejected`, false, String(e.message).slice(0, 60)); }
  try {
    const t = Date.now();
    const r = await fetch(`${SB}/functions/v1/${fn}`, { method: 'POST', headers: H, body: '{}', signal: AbortSignal.timeout(25000) });
    ok(`${fn}::authed-empty-body`, r.status < 500, `status=${r.status} ${Date.now() - t}ms`);
  } catch (e) { ok(`${fn}::authed-empty-body`, false, String(e.message).slice(0, 60)); }
}

// list-invoices: GET-only
try {
  const r = await fetch(`${SB}/functions/v1/list-invoices`, { method: 'POST', headers: H, body: '{}', signal: AbortSignal.timeout(20000) });
  ok('list-invoices::post-405', r.status === 405, `status=${r.status}`);
} catch (e) { ok('list-invoices::post-405', false, String(e.message).slice(0, 60)); }
try {
  const t = Date.now();
  const r = await fetch(`${SB}/functions/v1/list-invoices`, { headers: RH, signal: AbortSignal.timeout(25000) });
  const body = await r.json();
  // Contract: <500 normally; 503 with {"error":"Billing is not configured…"} is the
  // documented fail-fast when STRIPE_SECRET_KEY is absent in this deployment.
  const billingUnconfigured = r.status === 503 && typeof body.error === 'string' && body.error.includes('Billing is not configured');
  ok('list-invoices::authed-get', r.status < 500 || billingUnconfigured, `status=${r.status} ${Date.now() - t}ms`);
} catch (e) { ok('list-invoices::authed-get', false, String(e.message).slice(0, 60)); }

// generate-pdf: correct multi-case payload
if (cid) {
  try {
    const t = Date.now();
    const r = await fetch(`${SB}/functions/v1/generate-pdf`, {
      method: 'POST', headers: RH,
      body: JSON.stringify({ case_ids: [cid], resident_name: 'Probe Resident', tenant: 'Demo Tenant' }),
      signal: AbortSignal.timeout(40000),
    });
    const txt = await r.text();
    ok('generate-pdf::real-payload', r.status === 200 && txt.startsWith('%PDF'), `status=${r.status} magic=${txt.startsWith('%PDF')} ${Date.now() - t}ms`);
  } catch (e) { ok('generate-pdf::real-payload', false, String(e.message).slice(0, 60)); }
}
try {
  const r = await fetch(`${SB}/functions/v1/generate-pdf`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(25000) });
  ok('generate-pdf::noauth-rejected', [401, 403].includes(r.status), `status=${r.status}`);
} catch (e) { ok('generate-pdf::noauth-rejected', false, String(e.message).slice(0, 60)); }

// payment-webhook unsigned
try {
  const r = await fetch(`${SB}/functions/v1/payment-webhook`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{"type":"checkout.session.completed"}', signal: AbortSignal.timeout(20000) });
  ok('payment-webhook::unsigned-rejected', r.status >= 400 && r.status < 500, `status=${r.status}`);
} catch (e) { ok('payment-webhook::unsigned-rejected', false, String(e.message).slice(0, 60)); }

// scim: disabled-by-design. notoken -> stub 503; badtoken -> platform JWT gateway 401 (stricter than stub, correct).
for (const [label, hdrs, expect] of [['notoken', { apikey: KEY }, [503]], ['badtoken', { apikey: KEY, Authorization: 'Bearer bogus-token' }, [401, 503]]]) {
  try {
    const r = await fetch(`${SB}/functions/v1/scim/Users`, { method: 'GET', headers: hdrs, signal: AbortSignal.timeout(25000) });
    ok(`scim::${label}-disabled`, expect.includes(r.status), `status=${r.status}`);
  } catch (e) { ok(`scim::${label}-disabled`, false, String(e.message).slice(0, 60)); }
}

// sso-callback garbage code
try {
  const r = await fetch(`${SB}/functions/v1/sso-callback?code=garbage-probe`, { headers: { apikey: KEY }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  ok('sso-callback::bad-code', r.status < 500, `status=${r.status}`);
} catch (e) { ok('sso-callback::bad-code', false, String(e.message).slice(0, 60)); }

const failed = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ' :: ' + r.detail : ''}`);
console.log(`\nEdge-fleet contract probe v2: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
