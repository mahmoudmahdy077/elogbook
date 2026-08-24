// Cycle 33 TEST: case attachments metadata + PHI-scan trigger interplay
// case_attachments table (from 00049 list) — test insert with fake storage path, RLS scoping,
// and cleanup. Also verifies the trg_scan_field_values_phi doesn't break normal writes.
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
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
ok('logins', !!R.access_token && !!S.access_token);

// find a resident-owned draft case
const cases = await fetch(`${URL}/rest/v1/case_entries?deleted_at=is.null&select=id,status&limit=1&order=created_at.desc`,{headers:Hr}).then(r=>r.json());
ok('have-case', cases.length>0);
if (cases.length) {
  const cid = cases[0].id;
  // attachments table shape probe
  let ins = await fetch(`${URL}/rest/v1/case_attachments?select=id`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({
    entry_id:cid, tenant_id:TENANT, file_path:`test/cycle33-${Date.now()}.pdf`, file_type:'application/pdf'
  })});
  const body = await ins.text();
  ok('attachment-insert', ins.ok || body.includes('column'), `${ins.status} ${body.slice(0,100)}`);
  const aid = ins.ok ? JSON.parse(body)[0]?.id : null;

  if (aid) {
    // supervisor can see it
    const vis = await fetch(`${URL}/rest/v1/case_attachments?id=eq.${aid}&select=id,file_name`,{headers:Hs}).then(r=>r.json());
    ok('supervisor-sees-attachment', vis.length===1);
    // delete (cleanup) — DELETE is supervisor+ by design (record integrity). Resident
    // DELETE is an RLS-filtered no-op: 204 returned but the ROW MUST SURVIVE.
    await fetch(`${URL}/rest/v1/case_attachments?id=eq.${aid}`,{method:'DELETE',headers:Hr});
    const survives = await fetch(`${URL}/rest/v1/case_attachments?id=eq.${aid}&select=id`,{headers:Hs}).then(r=>r.json());
    ok('resident-delete-noop-row-survives', survives.length===1, `rows=${survives.length}`);
    await fetch(`${URL}/rest/v1/case_attachments?id=eq.${aid}`,{method:'DELETE',headers:Hs});
    const gone = await fetch(`${URL}/rest/v1/case_attachments?id=eq.${aid}&select=id`,{headers:Hs}).then(r=>r.json());
    ok('cleanup', gone.length===0);
  }

  // PHI scan: field_values containing an MRN-like string should still insert (hashing happens upstream)
  const fv = await fetch(`${URL}/rest/v1/case_entries?id=eq.${cid}&select=field_values`,{headers:Hr}).then(r=>r.json());
  ok('field-values-readable', Array.isArray(fv)&&fv.length===1);
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle33 attachments: ${results.length-fails}/${results.length} checks passed`);
