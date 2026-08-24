// Cycle 25 TEST: shifts/rotations/program-goals sync tables — insert, pull, update, delete
// via the fixed sync_push_batch RPC + direct RLS reads (mobile contract).
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

async function sync(table, rows) {
  return fetch(`${URL}/rest/v1/rpc/sync_push_batch`,{method:'POST',headers:H,body:JSON.stringify({p_table_name:table,p_rows:rows})});
}

// shifts: discover required columns first
const cols = await fetch(`${URL}/rest/v1/shifts?select=*&limit=0`,{headers:H});
// can't get columns from empty select; try minimal insert and read error if any
const sid = crypto.randomUUID();
let r = await sync('shifts',[{id:sid, tenant_id:TENANT}]).then(async res=>{
  // probe which columns are NOT NULL by attempting with common ones; first see error text
  const txt = await res.text();
  return {status:res.status, body:txt.slice(0,200)};
});
console.log('shift minimal insert:', r.status, r.body);
if (r.status===200) {
  const got = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=*`,{headers:H}).then(x=>x.json());
  ok('shift-created', Array.isArray(got)&&got[0]?.id===sid);
  // update via sync
  await sync('shifts',[{id:sid, tenant_id:TENANT, notes:'updated-by-cycle25'}]);
  const got2 = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=*`,{headers:H}).then(x=>x.json());
  ok('shift-updated-partial-safe', got2[0]?.notes==='updated-by-cycle25');
  // delete
  await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}`,{method:'DELETE',headers:H});
  const got3 = await fetch(`${URL}/rest/v1/shifts?id=eq.${sid}&select=id`,{headers:H}).then(x=>x.json());
  ok('shift-deleted', got3.length===0);
} else {
  // report NOT NULL columns so we know the mobile contract
  ok('shift-schema-probe', false, r.body);
}

// rotations & program_goals readable?
for (const t of ['rotations','program_goals']) {
  const rows = await fetch(`${URL}/rest/v1/${t}?select=*&limit=3`,{headers:H}).then(x=>x.json());
  ok(`${t}-readable`, Array.isArray(rows), `rows=${Array.isArray(rows)?rows.length:'ERR '+JSON.stringify(rows).slice(0,60)}`);
}

// cross-tenant rejection still enforced
r = await sync('case_entries',[{id:crypto.randomUUID(), tenant_id:'00000000-0000-0000-0000-000000000001', deleted_at:null}]);
const crossBody = await r.text().catch(()=>'');
ok('cross-tenant-rejected', !r.ok || JSON.parse(crossBody||'{}')<1, `${r.status}`);

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle25 shifts/sync: ${results.length-fails}/${results.length} checks passed`);
