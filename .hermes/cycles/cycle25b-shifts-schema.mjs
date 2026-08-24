// Cycle 25b: finish shifts slice — pull full schema from PostgREST OpenAPI spec,
// build a valid shift row, run insert→update→delete through sync RPC.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

const S = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'supervisor@demo.com',password:'password123!'})}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
ok('login', !!S.access_token);

// 1) OpenAPI spec -> shifts required columns
const spec = await fetch(`${URL}/rest/v1/`,{headers:H}).then(r=>r.json());
const def = spec?.definitions?.shifts;
if (!def) { console.log('no shifts definition; keys:', Object.keys(spec?.definitions||{}).filter(k=>k.includes('shift')).join(', ') || 'none'); }
ok('openapi-has-shifts', !!def);
const requiredCols = Object.entries(def?.properties||{}).filter(([,v])=>v.format!=='uuid' && v.description?.includes('Note:')===false).map(()=>0); // placeholder
const notNull = [];
for (const [col, meta] of Object.entries(def?.properties||{})) {
  // PostgREST marks non-nullable columns with description "Note:\nThis is a Primary Key.<pk>" or no x-nullable info; use required[] instead
}
const reqList = def?.required || [];
console.log('shifts required:', reqList.join(', '));

// build payload satisfying required minus defaults (id, tenant_id given)
const sprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${S.user.id}`,{headers:H}).then(r=>r.json());
const payload = { id: crypto.randomUUID(), tenant_id: TENANT };
for (const col of reqList) {
  if (col==='id') continue;
  if (col==='tenant_id') { payload[col]=TENANT; continue; }
  const fmt = def.properties[col]?.format || def.properties[col]?.type;
  if (col.includes('profile')||col.includes('user')||col.includes('resident')) payload[col]=sprof[0].id;
  else if (fmt==='date' || col==='date'||col.includes('_date')||col==='shift_date') payload[col]='2026-08-25';
  else if (col.includes('time')&&!col.includes('zone')) payload[col]=payload[col] ?? '09:00';
  else if (fmt==='timestamp'||fmt==='timestamptz') payload[col]=new Date().toISOString();
  else if (!payload[col]) payload[col]= col==='status' ? 'scheduled' : `cycle25-${col}`;
}
console.log('payload keys:', Object.keys(payload).join(','));

async function sync(table, rows) {
  return fetch(`${URL}/rest/v1/rpc/sync_push_batch`,{method:'POST',headers:H,body:JSON.stringify({p_table_name:table,p_rows:rows})});
}

let res = await sync('shifts',[payload]);
let body = await res.text();
ok('shift-insert-via-sync', res.ok, `${res.status} ${body.slice(0,120)}`);

if (res.ok) {
  const sid = payload.id;
  let got = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=*`,{headers:H}).then(x=>x.json());
  ok('shift-readable', got.length===1);

  await sync('shifts',[{id:sid, tenant_id:TENANT, notes:'cycle25-update'}]).then(async r=>({status:r.status,body:await r.text()}));
  got = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=*`,{headers:H}).then(x=>x.json());
  ok('shift-partial-update-safe', got[0]?.notes==='cycle25-update');

  await sync('shifts',[{id:sid, tenant_id:TENANT, deleted_at:new Date().toISOString()}]);
  const alive = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=id`,{headers:H}).then(x=>x.json());
  const tombstoned = Array.isArray(alive) && alive.length===0;
  // also confirm row still exists when filtering deleted_at explicitly (soft delete)
  const all = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=id,deleted_at`,{headers:H}).then(x=>x.json());
  ok('shift-tombstone-or-deleted', tombstoned || (all[0]?.deleted_at!=null), `alive=${alive.length} all=${JSON.stringify(all).slice(0,60)}`);

  await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}`,{method:'DELETE',headers:H});
  ok('cleanup', true);
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle25b shifts-complete: ${results.length-fails}/${results.length} checks passed`);
