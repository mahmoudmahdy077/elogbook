// Tombstone the pending row 8922e071 as resident — should now pass RLS (policy 3) AND trigger.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const R = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'resident@demo.com', password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY, Authorization:'Bearer '+R.access_token, 'Content-Type':'application/json'};
const id = '8922e071-7e61-4172-a856-c927f6afc6b7';
const res = await fetch(URL+'/rest/v1/case_entries?id=eq.'+id, {method:'PATCH', headers:H, body:JSON.stringify({deleted_at:new Date().toISOString()})});
console.log('resident tombstone on pending:', res.status, (await res.text()).slice(0,120));
const after = await fetch(URL+'/rest/v1/case_entries?id=eq.'+id+'&select=id,status,deleted_at', {headers:H}).then(r=>r.json());
console.log('state:', JSON.stringify(after));
