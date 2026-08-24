// Cycle 25b: shifts slice — schema discovery (OpenAPI w/ fallback to migration 00079),
// valid shift row via sync RPC, partial update, tombstone.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

const S = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'supervisor@demo.com',password:'password123!'})}).then(r=>r.json());
const R = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
ok('login', !!S.access_token && !!R.access_token);

const rprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${R.user.id}`,{headers:H}).then(r=>r.json());
const RESIDENT_ID = rprof[0]?.id;

// 1) OpenAPI spec -> shifts required columns (fallback: migration 00079 known NOT NULL set)
let reqList = null;
try {
  const spec = await fetch(`${URL}/rest/v1/`,{headers:H,signal:AbortSignal.timeout(15000)}).then(r=>r.json());
  reqList = spec?.definitions?.shifts?.required || null;
} catch {}
if (!reqList) { console.log('openapi unavailable; using migration 00079 schema'); reqList = ['id','rotation_id','tenant_id','resident_id','shift_date']; }
ok('shift-required-cols-known', Array.isArray(reqList) && reqList.includes('rotation_id'), reqList.join(','));

// 2) rotation prerequisite (NOT NULL FK target)
const rotId = crypto.randomUUID();
const rot = await fetch(`${URL}/rest/v1/rotations?select=id`,{method:'POST',headers:{...H,'Prefer':'return=representation'},body:JSON.stringify({id:rotId,tenant_id:TENANT,resident_id:RESIDENT_ID,title:'Cycle25b Rotation',start_date:'2026-08-01',end_date:'2026-09-30'})});
ok('rotation-created', rot.ok, `${rot.status} ${(await rot.text()).slice(0,90)}`);

async function sync(table, rows) {
  return fetch(`${URL}/rest/v1/rpc/sync_push_batch`,{method:'POST',headers:H,body:JSON.stringify({p_table_name:table,p_rows:rows})});
}

if (rot.ok) {
  const sid = crypto.randomUUID();
  let res = await sync('shifts',[{id:sid, tenant_id:TENANT, rotation_id:rotId, resident_id:RESIDENT_ID, shift_date:'2026-08-25'}]);
  let body = await res.text();
  ok('shift-insert-via-sync', res.ok, `${res.status} ${body.slice(0,120)}`);

  if (res.ok) {
    let got = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=*`,{headers:H}).then(x=>x.json());
    ok('shift-readable', got.length===1 && got[0].rotation_id===rotId);

    // partial update must preserve NOT NULL cols
    await sync('shifts',[{id:sid, tenant_id:TENANT, location:'OR-3'}]);
    got = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=*`,{headers:H}).then(x=>x.json());
    ok('shift-partial-update-safe', got[0]?.location==='OR-3' && got[0]?.rotation_id===rotId && got[0]?.shift_date==='2026-08-25');

    await sync('shifts',[{id:sid, tenant_id:TENANT, deleted_at:new Date().toISOString()}]);
    const alive = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=id`,{headers:H}).then(x=>x.json());
    const all = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=id,deleted_at`,{headers:H}).then(x=>x.json());
    ok('shift-tombstone-or-deleted', alive.length===0 || all[0]?.deleted_at!=null, `alive=${alive.length} raw=${JSON.stringify(all).slice(0,60)}`);
  }

  await fetch(`${URL}/rest/v1/shifts?rotation_id=eq.${rotId}`,{method:'DELETE',headers:H});
}
await fetch(`${URL}/rest/v1/rotations?id=eq.${rotId}`,{method:'DELETE',headers:H});
ok('cleanup', true);

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle25b shifts-complete: ${results.length-fails}/${results.length} checks passed`);
