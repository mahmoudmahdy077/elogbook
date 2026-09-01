// Deep-dive the 3 contract failures.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const login = async (email) => fetch(`${SB}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email, password: 'password123!' }), signal: AbortSignal.timeout(30000),
}).then(r => r.json());
const res_ = await login('resident@demo.com');
const RH = { apikey: KEY, Authorization: `Bearer ${res_.access_token}`, 'Content-Type': 'application/json' };
const prof = (await fetch(`${SB}/rest/v1/profiles?user_id=eq.${res_.user.id}&select=id`, { headers: RH }).then(r => r.json()))[0];
const cases = await fetch(`${SB}/rest/v1/case_entries?select=id&resident_id=eq.${prof.id}&status=eq.approved&deleted_at=is.null&limit=1`, { headers: RH }).then(r => r.json());
const cid = cases[0]?.id;

// 1. list-invoices via GET (correct verb?)
let r = await fetch(`${SB}/functions/v1/list-invoices`, { method: 'GET', headers: { apikey: KEY }, signal: AbortSignal.timeout(20000) });
console.log('list-invoices GET noauth:', r.status);
r = await fetch(`${SB}/functions/v1/list-invoices`, { method: 'GET', headers: RH, signal: AbortSignal.timeout(25000) });
console.log('list-invoices GET authed:', r.status, (await r.text()).slice(0, 120));

// 2. generate-pdf error body
r = await fetch(`${SB}/functions/v1/generate-pdf`, { method: 'POST', headers: RH, body: JSON.stringify({ case_id: cid }), signal: AbortSignal.timeout(30000) });
console.log('generate-pdf:', r.status, (await r.text()).slice(0, 300));

// 3. scim variants
r = await fetch(`${SB}/functions/v1/scim/Users`, { method: 'GET', headers: { apikey: KEY }, signal: AbortSignal.timeout(20000) });
console.log('scim notoken:', r.status, (await r.text()).slice(0, 150));
r = await fetch(`${SB}/functions/v1/scim/Users`, { method: 'GET', headers: { apikey: KEY, Authorization: 'Bearer bogus-token' }, signal: AbortSignal.timeout(20000) });
console.log('scim badtoken:', r.status, (await r.text()).slice(0, 150));
