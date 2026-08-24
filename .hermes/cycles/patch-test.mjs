// Manual PATCH test on one draft row — print exact PostgREST response
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
const rows = await fetch(URL+'/rest/v1/case_entries?deleted_at=is.null&status=eq.draft&select=id,status,tenant_id,resident_id&limit=1', {headers:H}).then(r=>r.json());
console.log('draft row:', JSON.stringify(rows));
if (rows[0]) {
  const res = await fetch(URL+'/rest/v1/case_entries?id=eq.'+rows[0].id, {
    method:'PATCH', headers:H, body:JSON.stringify({deleted_at:new Date().toISOString()})
  });
  console.log('PATCH:', res.status, await res.text());
  // re-check
  const after = await fetch(URL+'/rest/v1/case_entries?id=eq.'+rows[0].id+'&select=id,deleted_at', {headers:H}).then(r=>r.json());
  console.log('after:', JSON.stringify(after));
}
