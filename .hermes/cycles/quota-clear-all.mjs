// Tombstone ALL 20 demo-tenant rows as supervisor (demo data, safe to clear for testing)
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const s = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
  body: JSON.stringify({email:'supervisor@demo.com',password:'password123!'}), signal: AbortSignal.timeout(30000)
}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':`Bearer ${s.access_token}`,'Content-Type':'application/json'};
const rows = await fetch(`${URL}/rest/v1/case_entries?deleted_at=is.null&status=eq.pending&select=id&tenant_id=eq.${TENANT}`, {headers:H}).then(r=>r.json());
let n=0;
for (const r of rows) {
  const res = await fetch(`${URL}/rest/v1/case_entries?id=eq.${r.id}`, {method:'PATCH',headers:H,body:JSON.stringify({deleted_at:new Date().toISOString()})});
  if (res.ok) n++;
}
console.log('tombstoned all:', n);
const q = await fetch(`${URL}/rest/v1/rpc/check_case_quota`, {method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}).then(r=>r.json());
console.log('quota:', JSON.stringify(q));
