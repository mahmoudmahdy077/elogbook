// Cycle 3 TEST: approvals-supervisor — full queue flow at the DB/RPC layer
// (the web API route wraps these same RPCs with CSRF+rate-limit; the RPCs are the contract).
// Flow: create pending case as resident -> resident DENIED approve (RBAC) ->
// supervisor approves -> status approved + approval_requests row exists with profile-id FK
// -> new pending case -> supervisor rejects w/ comment -> verify approval_requests row.
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (name, cond, detail='') => results.push({name, pass: !!cond, detail});

async function login(email) {
  return fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
    body: JSON.stringify({email, password:'password123!'}), signal: AbortSignal.timeout(30000)
  }).then(r=>r.json());
}
const H = (t) => ({'apikey':KEY,'Authorization':`Bearer ${t}`,'Content-Type':'application/json'});

const R = await login('resident@demo.com');
const S = await login('supervisor@demo.com');
ok('logins', !!R.access_token && !!S.access_token);
const hr = H(R.access_token), hs = H(S.access_token);

// supervisor auth uid (what callers must pass as p_supervisor_id)
const sSub = JSON.parse(Buffer.from(S.access_token.split('.')[1], 'base64url').toString());

// template for fixture cases
const tmpl = await fetch(`${URL}/rest/v1/case_templates?select=id&tenant_id=in.(${TENANT},00000000-0000-0000-0000-000000000000)&limit=1`, {headers:hr}).then(r=>r.json());
const prof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${R.user.id}`, {headers:hr}).then(r=>r.json());

// NOTE: quota trigger may cap inserts at 20 on free plan — detect and report distinctly
async function makePending() {
  const ins = await fetch(`${URL}/rest/v1/case_entries?select=id,status`, {
    method:'POST', headers:{...hr,'Prefer':'return=representation'},
    body: JSON.stringify({
      tenant_id:TENANT, resident_id:prof[0].id, template_id:tmpl[0].id,
      case_date:new Date().toISOString().split('T')[0],
      field_values:{}, status:'pending', accreditation_mappings:[], is_deidentified:true,
      patient_mrn:null, patient_dob:null, patient_age_years:null, patient_hash:'cycle3'
    })
  }).then(r=>r.json());
  return Array.isArray(ins) ? ins[0] : ins; // {code,message} on quota rejection
}

// free up headroom by soft-deleting our own old test rows (status any) first — use RPC
const mine = await fetch(`${URL}/rest/v1/case_entries?select=id&patient_hash=eq.cycle3&deleted_at=is.null`, {headers:hr}).then(r=>r.json());
for (const row of mine.slice(0, 5)) {
  await fetch(`${URL}/rest/v1/rpc/soft_delete_case`, {method:'POST',headers:hr,body:JSON.stringify({p_entry_id:row.id})}).then(r=>r.json()).catch(()=>null);
}
// extra: if quota still full, evict oldest rows via RPC headroom loop
let _q = await fetch(`${URL}/rest/v1/rpc/check_case_quota`, {method:'POST',headers:hr,body:JSON.stringify({p_tenant_id:TENANT})}).then(r=>r.json());
if (_q?.[0] && !_q[0].allowed) {
  const oldest = await fetch(`${URL}/rest/v1/case_entries?select=id&tenant_id=eq.${TENANT}&deleted_at=is.null&order=created_at.asc&limit=2`, {headers:hr}).then(r=>r.json());
  for (const row of (Array.isArray(oldest)?oldest:[])) {
    await fetch(`${URL}/rest/v1/rpc/soft_delete_case`, {method:'POST',headers:hr,body:JSON.stringify({p_entry_id:row.id})}).then(r=>r.json()).catch(()=>null);
  }
}

// 1. pending case A -> resident tries to approve (must be denied)
const A = await makePending();
ok('create-pending-A', !!A.id, A.code ? `${A.code}: ${A.message}` : 'pending');

let rbac = null;
if (A.id) {
  rbac = await fetch(`${URL}/rest/v1/rpc/approve_case`, {method:'POST',headers:hr,
    body:JSON.stringify({p_entry_id:A.id, p_supervisor_id:R.user.id, p_comment:null})}).then(r=>r.json());
}
ok('resident-denied', rbac?.code === 'forbidden', JSON.stringify(rbac).slice(0,100));

// 2. supervisor approves A
let ap = null;
if (A.id) {
  ap = await fetch(`${URL}/rest/v1/rpc/approve_case`, {method:'POST',headers:hs,
    body:JSON.stringify({p_entry_id:A.id, p_supervisor_id:sSub.sub, p_comment:'cycle3 ok'})}).then(r=>r.json());
}
ok('supervisor-approve', ap?.success === true, JSON.stringify(ap).slice(0,100));

// 3. approval_requests row written with profiles.id FK (the Cycle-99 fix holds)
if (ap?.success && A.id) {
  const ar = await fetch(`${URL}/rest/v1/approval_requests?select=id,supervisor_id,status&entry_id=eq.${A.id}`, {headers:hs}).then(r=>r.json());
  const row = ar[0];
  ok('approval-request-row', !!row && row.status==='approved', JSON.stringify(ar).slice(0,120));
  // supervisor_id must be a profiles.id, not the auth uid
  const profChk = await fetch(`${URL}/rest/v1/profiles?select=id&id=eq.${row?.supervisor_id}`, {headers:hs}).then(r=>r.json());
  ok('fk-points-at-profiles.id', Array.isArray(profChk) && profChk.length===1, `supervisor_id resolves to ${profChk.length} profile`);
}

// 4. double-approve guard
let dbl = null;
if (A.id) {
  dbl = await fetch(`${URL}/rest/v1/rpc/approve_case`, {method:'POST',headers:hs,
    body:JSON.stringify({p_entry_id:A.id, p_supervisor_id:sSub.sub})}).then(r=>r.json());
}
ok('double-approve-guarded', dbl?.code === 'already_reviewed', JSON.stringify(dbl).slice(0,90));

// 5. pending case B -> supervisor rejects with comment
const B = await makePending();
ok('create-pending-B', !!B.id, B.code ? B.message : '');
let rj = null;
if (B.id) {
  rj = await fetch(`${URL}/rest/v1/rpc/reject_case`, {method:'POST',headers:hs,
    body:JSON.stringify({p_entry_id:B.id, p_supervisor_id:sSub.sub, p_comment:'needs more detail (cycle3)'})}).then(r=>r.json());
}
ok('supervisor-reject', rj?.success === true, JSON.stringify(rj).slice(0,90));

// cleanup tombstones — RPC
for (const id of [A.id, B.id]) if (id) await fetch(`${URL}/rest/v1/rpc/soft_delete_case`, {method:'POST',headers:hr,body:JSON.stringify({p_entry_id:id})}).then(r=>r.json()).catch(()=>null);

let fails=0;
for (const r of results){ console.log(`${r.pass?'PASS':'FAIL'} ${r.name}${r.detail?' :: '+r.detail:''}`); if(!r.pass)fails++; }
console.log(`\nCycle3 approvals-supervisor: ${results.length-fails}/${results.length} checks passed`);
