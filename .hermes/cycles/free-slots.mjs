// Tombstone all remaining test rows via sync RPC (works for any status), keeping 2 slots free
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const S = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'supervisor@demo.com', password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY, Authorization:'Bearer '+S.access_token, 'Content-Type':'application/json'};

const rows = await fetch(`${URL}/rest/v1/case_entries?deleted_at=is.null&select=id&tenant_id=eq.${TENANT}&order=created_at.asc`, {headers:H}).then(r=>r.json());
// keep the last 2, tombstone the rest
const toDelete = rows.slice(0, Math.max(0, rows.length - 2));
console.log('rows:', rows.length, '| deleting:', toDelete.length);

let ok = 0;
for (const r of toDelete) {
  const res = await fetch(URL+'/rest/v1/rpc/sync_push_batch', {method:'POST',headers:H,body:JSON.stringify({
    p_table_name:'case_entries',
    p_rows:[{id:r.id, tenant_id:TENANT, deleted_at:new Date().toISOString()}]
  })});
  if (res.ok) { const j = await res.json(); ok += j; }
  else console.log('fail', r.id, res.status, (await res.text()).slice(0,80));
}
console.log('tombstoned:', ok);
const q = await fetch(URL+'/rest/v1/rpc/check_case_quota', {method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}).then(r=>r.json());
console.log('quota:', JSON.stringify(q));
