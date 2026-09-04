// Free demo-tenant quota slots so the approvals suite never wedges.
// Tombstones approved cases down to TARGET active rows (keeps a few for realism).
// Invoked by run-loop-1000.mjs right before cycle3-approvals each rotation.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TARGET_FREE = parseInt(process.env.FREE_SLOTS_TARGET || '8', 10);
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';

const S = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY },
  body: JSON.stringify({ email: 'supervisor@demo.com', password: 'password123!' })
}).then(r => r.json());
if (!S.access_token) { console.log('[free-slots] login FAIL'); process.exit(1); }
const H = { 'apikey': KEY, Authorization: 'Bearer ' + S.access_token, 'Content-Type': 'application/json' };

const list = await fetch(URL + '/rest/v1/case_entries?select=id,deleted_at&deleted_at=is.null&order=created_at.desc&limit=1000', { headers: H }).then(r => r.json());
if (!Array.isArray(list)) { console.log('[free-slots] list FAIL', JSON.stringify(list).slice(0, 120)); process.exit(1); }
const active = list.length;
const quota = 20;
const need = active + TARGET_FREE - quota;
if (need <= 0) { console.log(`[free-slots] ${active} active, ${-need} spare — no cleanup needed`); process.exit(0); }
console.log(`[free-slots] ${active} active, need to free ${need}`);
const victims = list.slice(0, need);
let ok = 0;
for (const row of victims) {
  const res = await fetch(URL + '/rest/v1/rpc/sync_push_batch', {
    method: 'POST', headers: H,
    body: JSON.stringify({ p_table_name: 'case_entries', p_rows: [{ id: row.id, tenant_id: TENANT, deleted_at: new Date().toISOString() }] })
  });
  if (res.status === 200) ok++; else console.log('[free-slots] tombstone FAIL', row.id.slice(0, 8), res.status);
}
console.log(`[free-slots] freed ${ok}/${need}`);
process.exit(ok === need ? 0 : 1);
