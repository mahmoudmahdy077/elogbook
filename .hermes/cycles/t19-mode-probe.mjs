// One-off: read demo tenant data-mode flags to confirm T19 state (root cause for replay 42501s).
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
  body: JSON.stringify({email:'supervisor@demo.com',password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':`Bearer ${login.access_token}`};
const tenants = await fetch(`${URL}/rest/v1/tenants?select=id,slug,allow_identifiable,data_mode_requested`, {headers:H}).then(r=>r.json());
console.log(JSON.stringify(tenants, null, 1));
