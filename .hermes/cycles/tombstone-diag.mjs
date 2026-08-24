// Diagnose why tombstone PATCH still 403s despite migration applied:
// 1) try supervisor tombstone (new policy should allow any tenant row)
// 2) try resident tombstone on an APPROVED own row
// 3) print exact error for each
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
async function login(email) {
  return fetch(URL + '/auth/v1/token?grant_type=password', {
    method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
    body: JSON.stringify({email, password:'password123!'})
  }).then(r=>r.json());
}
const R = await login('resident@demo.com');
const S = await login('supervisor@demo.com');
const Hr = {'apikey':KEY, Authorization:'Bearer '+R.access_token, 'Content-Type':'application/json'};
const Hs = {'apikey':KEY, Authorization:'Bearer '+S.access_token, 'Content-Type':'application/json'};

const rows = await fetch(URL+'/rest/v1/case_entries?deleted_at=is.null&select=id,status&limit=3', {headers:Hr}).then(r=>r.json());
console.log('sample rows:', JSON.stringify(rows));

if (rows[0]) {
  // supervisor attempts first (new policy: supervisor+ soft delete tenant entries)
  const s1 = await fetch(URL+'/rest/v1/case_entries?id=eq.'+rows[0].id, {method:'PATCH', headers:Hs, body:JSON.stringify({deleted_at:new Date().toISOString()})});
  console.log('SUPERVISOR tombstone ->', s1.status, (await s1.text()).slice(0,100));
}
if (rows[1]) {
  const r1 = await fetch(URL+'/rest/v1/case_entries?id=eq.'+rows[1].id, {method:'PATCH', headers:Hr, body:JSON.stringify({deleted_at:new Date().toISOString()})});
  console.log('RESIDENT tombstone ->', r1.status, (await r1.text()).slice(0,100));
}
