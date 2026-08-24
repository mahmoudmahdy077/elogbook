// Isolate sync_push_batch health: try INSERT-new + UPDATE-existing on shifts (no quota trigger)
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
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const newId = crypto.randomUUID();

// INSERT new shift
let res = await fetch(URL+'/rest/v1/rpc/sync_push_batch', {method:'POST',headers:H,body:JSON.stringify({
  p_table_name:'shifts',
  p_rows:[{id:newId, tenant_id:TENANT, date:'2026-08-24', start_time:'09:00', end_time:'17:00'}]
})});
console.log('shift insert:', res.status, (await res.text()).slice(0,120));

// UPDATE same row via upsert
res = await fetch(URL+'/rest/v1/rpc/sync_push_batch', {method:'POST',headers:H,body:JSON.stringify({
  p_table_name:'shifts',
  p_rows:[{id:newId, tenant_id:TENANT, end_time:'18:30'}]
})});
console.log('shift update(upsert):', res.status, (await res.text()).slice(0,120));

// cleanup
await fetch(URL+'/rest/v1/shifts?id=eq.'+newId, {method:'DELETE', headers:H});
console.log('cleanup done');
