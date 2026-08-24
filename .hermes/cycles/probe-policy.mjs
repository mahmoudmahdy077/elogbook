// Flip a draft to pending (resident, allowed by old policy), then resident tombstone.
// If tombstone succeeds -> my new policy exists. If 403 -> policy missing on remote (drift).
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
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

let res = await fetch(URL+'/rest/v1/case_entries?id=eq.'+id, {method:'PATCH', headers:H, body:JSON.stringify({status:'pending'})});
console.log('draft->pending:', res.status);

res = await fetch(URL+'/rest/v1/case_entries?id=eq.'+id, {method:'PATCH', headers:H, body:JSON.stringify({deleted_at:new Date().toISOString()})});
console.log('pending tombstone:', res.status, (await res.text()).slice(0,90));

const after = await fetch(URL+'/rest/v1/case_entries?id=eq.'+id+'&select=id,status,deleted_at', {headers:H}).then(r=>r.json());
console.log('state:', JSON.stringify(after));
