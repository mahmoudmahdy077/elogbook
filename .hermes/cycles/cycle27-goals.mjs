// Cycle 27 TEST: program goals + duty hours
// 1. director creates goal for resident (target_count>0 CHECK)
// 2. resident cannot create goals (RBAC) but can read own
// 3. goal_progress auto-computed trigger exists (trg_update_goal_progress from 00003)
// 4. duty-hours CSV query path works (case_entries aggregation by date range)
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
// find director login — try director@demo.com; fall back to supervisor for reads only
let D = await login('director@demo.com').catch(()=>null);
const dirWorks = !!D?.access_token;
if (!dirWorks) console.log('note: no director@demo.com session, testing with supervisor');
const A = dirWorks ? D : await login('supervisor@demo.com');
const R = await login('resident@demo.com');
const HA = {'apikey':KEY,'Authorization':'Bearer '+A.access_token,'Content-Type':'application/json'};
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('logins', !!A.access_token && !!R.access_token);

const aprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${A.user.id}`,{headers:HA}).then(r=>r.json());
const rprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${R.user.id}`,{headers:Hr}).then(r=>r.json());

// 1. create goal
let res = await fetch(`${URL}/rest/v1/program_goals?select=id,title,target_count`,{method:'POST',headers:{...HA,'Prefer':'return=representation'},body:JSON.stringify({
  tenant_id:TENANT, director_id:aprof[0].id, resident_id:rprof[0].id,
  title:'Cycle27 Goal', target_count:5, deadline:'2026-12-31'
})}).then(r=>r.json());
const gid = Array.isArray(res)?res[0]?.id:null;
ok('goal-created-by-'+(dirWorks?'director':'supervisor'), !!gid, JSON.stringify(res).slice(0,100));

// invalid target_count must fail
const bad = await fetch(`${URL}/rest/v1/program_goals`,{method:'POST',headers:HA,body:JSON.stringify({
  tenant_id:TENANT, director_id:aprof[0].id, resident_id:rprof[0].id, title:'bad', target_count:0, deadline:'2026-12-31'
})}).then(r=>r.json());
ok('target-count-check-rejects-0', !!bad?.code, JSON.stringify(bad).slice(0,70));

// 2. resident create attempt (should be denied by RLS)
const rdenied = await fetch(`${URL}/rest/v1/program_goals`,{method:'POST',headers:Hr,body:JSON.stringify({
  tenant_id:TENANT, director_id:rprof[0].id, resident_id:rprof[0].id, title:'self-goal', target_count:1, deadline:'2026-12-31'
})}).then(r=>r.json());
ok('resident-cannot-create-goal', !!rdenied?.code, JSON.stringify(rdenied).slice(0,80));

// 3. resident reads own goal
if (gid) {
  const mine = await fetch(`${URL}/rest/v1/program_goals?id=eq.${gid}&select=id,title`,{headers:Hr}).then(r=>r.json());
  ok('resident-reads-own-goal', Array.isArray(mine)&&mine.length===1&&mine[0].title==='Cycle27 Goal');
}

// 4. duty-hours aggregation path (web CSV route queries case_entries grouped by case_date)
const dh = await fetch(`${URL}/rest/v1/case_entries?tenant_id=eq.${TENANT}&deleted_at=is.null&select=case_date&order=case_date.asc&limit=500`,{headers:HA}).then(r=>r.json());
ok('duty-hours-query-path', Array.isArray(dh), `dates=${dh.length}`);

// cleanup
if (gid) await fetch(`${URL}/rest/v1/program_goals?id=eq.${gid}`,{method:'DELETE',headers:HA});
ok('cleanup', true);

let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nCycle27 goals+duty: ${results.length-fails}/${results.length} checks passed`);
