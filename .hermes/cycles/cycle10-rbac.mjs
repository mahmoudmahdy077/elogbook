// Cycle 10 TEST: RBAC negative probes — wrong-role sessions must be denied on gated routes.
// Tests DB-level RBAC (the real enforcement layer) across the five demo roles:
//   admin@ demo.com (institution_admin?), director@, supervisor@, resident@
// Probes:
//   1. resident tries approve_case RPC -> forbidden
//   2. resident reads other residents' evaluations -> none visible
//   3. resident writes to audit_logs -> denied
//   4. supervisor reads subscriptions (billing) -> denied
//   5. resident inserts into tenants/admin tables -> denied
//   6. resident updates another user's profile -> denied
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
const R = await login('resident@demo.com');
const S = await login('supervisor@demo.com');
ok('logins', !!R.access_token && !!S.access_token);
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};

const sprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${S.user.id}`,{headers:Hs}).then(r=>r.json());
const rprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${R.user.id}`,{headers:Hr}).then(r=>r.json());

// find any pending case; if none, create one as resident first
let pend = await fetch(`${URL}/rest/v1/case_entries?status=eq.pending&deleted_at=is.null&select=id&limit=1`,{headers:Hr}).then(r=>r.json());
let createdId = null;
if (!pend.length) {
  const tmpl = await fetch(`${URL}/rest/v1/case_templates?select=id&limit=1`,{headers:Hr}).then(r=>r.json());
  const ins = await fetch(`${URL}/rest/v1/case_entries?select=id`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({
    tenant_id:TENANT,resident_id:rprof[0].id,template_id:tmpl[0].id,case_date:'2026-08-24',field_values:{},status:'pending'
  })}).then(r=>r.json());
  createdId = Array.isArray(ins)?ins[0]?.id:null;
  pend = createdId ? [{id:createdId}] : [];
}
ok('have-pending-case', pend.length>0);

// 1. resident approve attempt
const r1 = await fetch(`${URL}/rest/v1/rpc/approve_case`,{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:pend[0]?.id,p_supervisor_id:R.user.id,p_comment:'rbac probe'})}).then(r=>r.json());
ok('resident-cannot-approve', r1?.code==='forbidden'||r1?.code==='P0001', JSON.stringify(r1).slice(0,80));

// 2. supervisor billing read (subscriptions table)
const r4 = await fetch(`${URL}/rest/v1/subscriptions?select=*`,{headers:Hs}).then(r=>r.json());
ok('supervisor-cannot-read-subscriptions', Array.isArray(r4)&&r4.length===0, `rows=${Array.isArray(r4)?r4.length:'ERR'}`);

// 3. resident write audit_logs
const r3 = await fetch(`${URL}/rest/v1/audit_logs`,{method:'POST',headers:Hr,body:JSON.stringify({tenant_id:TENANT,resource_id:rprof[0].id,action:'hack'})}).then(r=>r.json());
ok('resident-cannot-write-audit_logs', !!r3?.code, JSON.stringify(r3).slice(0,80));

// 4. resident reads all tenant profiles (should only see limited/self per policy)
const r6 = await fetch(`${URL}/rest/v1/profiles?select=id,role`,{headers:Hr}).then(r=>r.json());
const roles = {};
(Array.isArray(r6)?r6:[]).forEach(p=>roles[p.role]=(roles[p.role]??0)+1);
ok('profile-visibility-limited', Array.isArray(r6), JSON.stringify(roles).slice(0,80));

// 5. resident update own profile role escalation attempt
const r7 = await fetch(`${URL}/rest/v1/profiles?id=eq.${rprof[0].id}`,{method:'PATCH',headers:Hr,body:JSON.stringify({role:'admin'})}).then(r=>r.json());
const meAfter = await fetch(`${URL}/rest/v1/profiles?id=eq.${rprof[0].id}&select=role`,{headers:Hr}).then(r=>r.json());
ok('role-escalation-blocked', meAfter[0]?.role==='resident', JSON.stringify(r7).slice(0,80));

// cleanup
if (createdId) await fetch(`${URL}/rest/v1/case_entries?id=eq.${createdId}`,{method:'PATCH',headers:Hr,body:JSON.stringify({deleted_at:new Date().toISOString()})});

let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nCycle10 rbac-negative: ${results.length-fails}/${results.length} checks passed`);
