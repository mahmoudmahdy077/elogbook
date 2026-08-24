// Minimal repro: single-row push with ONLY id+tenant_id+deleted_at, print full SQL error
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'supervisor@demo.com', password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY, Authorization:'Bearer '+S.access_token, 'Content-Type':'application/json'};

// 1. empty rows array — does the new function even run its loop?
const r1 = await fetch(URL+'/rest/v1/rpc/sync_push_batch', {method:'POST',headers:H,body:JSON.stringify({p_table_name:'case_entries',p_rows:[]})});
console.log('empty batch:', r1.status, await r1.text());

// 2. row missing tenant_id → old code raised 'row missing tenant_id'; my rewrite forces tenant
const r2 = await fetch(URL+'/rest/v1/rpc/sync_push_batch', {method:'POST',headers:H,body:JSON.stringify({p_table_name:'case_entries',p_rows:[{id:'00000000-0000-0000-0000-00000000dead'}]})});
console.log('no-tenant row:', r2.status, await r2.text());
