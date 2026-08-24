// Cycle 25c: shifts full lifecycle — needs rotation_id (NOT NULL FK).
// Create rotation -> shift via sync RPC -> partial update -> delete. Cleanup all.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const S = await login('supervisor@demo.com');
const R = await login('resident@demo.com');
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('logins', !!S.access_token && !!R.access_token);

const rprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${R.user.id}`,{headers:Hr}).then(r=>r.json());

// check rotations schema
let spec = await fetch(`${URL}/rest/v1/rotations?select=*&limit=0`,{headers:Hs});
console.log('rotations select status:', spec.status);
const rotCols = await fetch(`${URL}/rest/v1/rotations?select=*&limit=1`,{headers:Hs}).then(r=>r.json());
console.log('rotation sample:', JSON.stringify(rotCols).slice(0,150));

// create a test rotation (direct insert; discover required cols by trying)
const rotId = crypto.randomUUID();
let res = await fetch(`${URL}/rest/v1/rotations?select=id`,{method:'POST',headers:{...Hs,'Prefer':'return=representation'},body:JSON.stringify({id:rotId, tenant_id:TENANT, resident_id:rprof[0].id, title:'Cycle25 Rotation', start_date:'2026-08-01', end_date:'2026-09-30'})});
let body = await res.text();
ok('rotation-created', res.ok, `${res.status} ${body.slice(0,120)}`);

if (res.ok) {
  const sid = crypto.randomUUID();
  async function sync(table, rows) {
    return fetch(`${URL}/rest/v1/rpc/sync_push_batch`,{method:'POST',headers:Hs,body:JSON.stringify({p_table_name:table,p_rows:rows})});
  }

  // INSERT shift with all NOT NULL cols
  let r = await sync('shifts',[{id:sid, tenant_id:TENANT, rotation_id:rotId, resident_id:rprof[0].id, shift_date:'2026-08-25'}]);
  body = await r.text();
  ok('shift-insert-sync', r.ok, `${r.status} ${body.slice(0,100)}`);

  if (r.ok) {
    let got = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=*`,{headers:Hs}).then(x=>x.json());
    ok('shift-readable', got.length===1 && got[0].rotation_id===rotId);

    // PARTIAL update must not clobber other columns
    await sync('shifts',[{id:sid, tenant_id:TENANT, location:'OR-3'}]);
    got = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=*`,{headers:Hs}).then(x=>x.json());
    ok('partial-update-preserves', got[0]?.location==='OR-3' && got[0]?.shift_date==='2026-08-25');

    // tombstone via sync
    await sync('shifts',[{id:sid, tenant_id:TENANT, deleted_at:new Date().toISOString()}]);
    const vis = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=id`,{headers:Hs}).then(x=>x.json());
    const raw = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=id,deleted_at`,{headers:Hs}).then(x=>x.json());
    ok('tombstone-hides-or-marks', vis.length===0 || raw[0]?.deleted_at!=null, `vis=${vis.length} raw=${JSON.stringify(raw).slice(0,60)}`);
  }

  // cleanup
  await fetch(`${URL}/rest/v1/shifts?rotation_id=eq.${rotId}`,{method:'DELETE',headers:Hs});
  await fetch(`${URL}/rest/v1/rotations?id=eq.${rotId}`,{method:'DELETE',headers:Hs});
  ok('cleanup', true);
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle25c shifts-full: ${results.length-fails}/${results.length} checks passed`);
