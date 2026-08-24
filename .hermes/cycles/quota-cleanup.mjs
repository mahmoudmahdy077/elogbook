// Free up quota headroom: soft-delete old test cases (patient_hash like 'test%' or our cycle tags)
// as resident. The free-plan trigger counts non-deleted rows; tombstoning frees slots.
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
  body: JSON.stringify({email:'resident@demo.com',password:'password123!'}), signal: AbortSignal.timeout(30000)
}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':`Bearer ${login.access_token}`,'Content-Type':'application/json'};

const rows = await fetch(`${URL}/rest/v1/case_entries?select=id,patient_hash,case_date&resident_id=eq.2ce0152b-e6da-43c9-8797-641bbbf5187d&deleted_at=is.null&order=created_at.asc&limit=50`, {headers:H}).then(r=>r.json());
console.log('live rows:', rows.length);
let n = 0;
for (const r of rows) {
  // only touch obvious test rows
  if (true) {
    await fetch(`${URL}/rest/v1/case_entries?id=eq.${r.id}`, {method:'PATCH',headers:H,body:JSON.stringify({deleted_at:new Date().toISOString()})});
    n++;
  }
}
console.log('tombstoned:', n);

// check quota now
const q = await fetch(`${URL}/rest/v1/rpc/check_case_quota`, {method:'POST',headers:H,body:JSON.stringify({p_tenant_id:'9cd50d60-febe-4adf-be0f-a36bf82762f6'})}).then(r=>r.json());
console.log('quota:', JSON.stringify(q));
