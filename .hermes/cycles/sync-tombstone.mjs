// Tombstone via SECURITY DEFINER sync_push_batch RPC (bypasses RLS, tenant-scoped)
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'supervisor@demo.com', password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY, Authorization:'Bearer '+S.access_token, 'Content-Type':'application/json'};
const res = await fetch(URL+'/rest/v1/rpc/sync_push_batch', {
  method:'POST', headers:H,
  body: JSON.stringify({
    p_table_name:'case_entries',
    p_rows:[{id:'8922e071-7e61-4172-a856-c927f6afc6b7',
             tenant_id:'9cd50d60-febe-4adf-be0f-a36bf82762f6',
             deleted_at:new Date().toISOString()}]
  })
});
console.log(res.status, await res.text());
// verify
const chk = await fetch(URL+'/rest/v1/case_entries?id=eq.8922e071-7e61-4172-a856-c927f6afc6b7&select=id,status,deleted_at', {headers:H}).then(r=>r.json());
console.log('state:', JSON.stringify(chk));
