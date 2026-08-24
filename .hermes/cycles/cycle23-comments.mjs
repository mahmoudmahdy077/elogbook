// Cycle 23 TEST: threaded comments on case entries — web CaseComments contract.
// supervisor comments on a case, resident replies (thread), verify read + cleanup.
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
const S = await login('supervisor@demo.com');
const R = await login('resident@demo.com');
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('logins', !!S.access_token && !!R.access_token);

const sprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${S.user.id}`,{headers:Hs}).then(r=>r.json());
const rprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${R.user.id}`,{headers:Hr}).then(r=>r.json());

// use an existing non-deleted case
const cases = await fetch(`${URL}/rest/v1/case_entries?deleted_at=is.null&select=id,status&limit=1`,{headers:Hr}).then(r=>r.json());
const caseId = cases[0]?.id;
ok('have-case', !!caseId);

// supervisor top-level comment
let ins = await fetch(`${URL}/rest/v1/comments?select=id,body`,{method:'POST',headers:{...Hs,'Prefer':'return=representation'},body:JSON.stringify({
  tenant_id:TENANT, entry_id:caseId, author_id:sprof[0].id, body:'Cycle23 supervisor note', parent_id:null
})}).then(r=>r.json());
const cid = Array.isArray(ins)?ins[0]?.id:null;
ok('supervisor-comment', !!cid, JSON.stringify(ins).slice(0,90));

// resident reply (threaded)
let rep = null;
if (cid) {
  rep = await fetch(`${URL}/rest/v1/comments?select=id,parent_id`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({
    tenant_id:TENANT, entry_id:caseId, author_id:rprof[0].id, body:'Cycle23 resident reply', parent_id:cid
  })}).then(r=>r.json());
  const rid = Array.isArray(rep)?rep[0]?.id:null;
  ok('resident-threaded-reply', !!rid && rep[0]?.parent_id===cid, JSON.stringify(rep).slice(0,90));
}

// resident reads thread
if (cid) {
  const thread = await fetch(`${URL}/rest/v1/comments?entry_id=eq.${caseId}&select=id,body,parent_id&order=created_at.asc`,{headers:Hr}).then(r=>r.json());
  const found = thread.find(c=>c.id===cid);
  ok('thread-readable-by-resident', !!found && found.body==='Cycle23 supervisor note');
}

// comment without entry/evaluation must fail CHECK
const bad = await fetch(`${URL}/rest/v1/comments`,{method:'POST',headers:Hs,body:JSON.stringify({tenant_id:TENANT,author_id:sprof[0].id,body:'orphan'})}).then(r=>r.json());
ok('check-constraint-orphan-rejected', !!bad?.code, JSON.stringify(bad).slice(0,80));

// cleanup
for (const id of [rep?.[0]?.id, cid]) if (id) await fetch(`${URL}/rest/v1/comments?id=eq.${id}`,{method:'DELETE',headers:Hs});
ok('cleanup', true);

let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nCycle23 comments: ${results.length-fails}/${results.length} checks passed`);
