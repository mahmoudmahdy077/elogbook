// Isolate the failing WITH CHECK clause: patch field_values only, then deleted_at with status kept,
// then a no-op update.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const l = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'resident@demo.com', password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY, Authorization:'Bearer '+l.access_token, 'Content-Type':'application/json'};
const id = '679505e2-b76b-4fc8-bb70-9f3e66deb588';

async function try_(label, body) {
  const res = await fetch(`${URL}/rest/v1/case_entries?id=eq.${id}`, {method:'PATCH', headers:H, body:JSON.stringify(body)});
  console.log(label, '->', res.status, (await res.text()).slice(0,90));
}
await try_('field_values only', {field_values:{t:1}});
await try_('case_date only', {case_date:'2026-08-23'});
await try_('deleted_at null->null noop', {deleted_at:null});
