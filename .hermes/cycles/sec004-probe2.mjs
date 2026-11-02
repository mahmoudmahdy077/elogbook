// Live verification of SEC-004 evaluation_forms status guard (backlog #11),
// round 2: demo tenant has zero forms, so insert a scratch form and exercise
// the state machine on it. Cleanup deletes the scratch row at the end.
// Legal path exercised: pending -> completed (204 expected).
// Illegal attempts (must be REJECTED, no mutation):
//   completed -> pending (backwards)
//   completed -> acknowledged -> status flip back -> completed
//   acknowledged content PATCH (ratings/feedback)
//   insert with status='acknowledged' directly
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const results = [];
const ok = (n, c, d = '') => results.push({ n, p: !!c, d });

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'}),signal:AbortSignal.timeout(30000)}).then(r=>r.json());}
const S = await login('supervisor@demo.com');
ok('login', !!S.access_token);
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const j = (r) => r.json();

const prof = await fetch(`${URL}/rest/v1/profiles?select=id,tenant_id&user_id=eq.${S.user.id}`,{headers:Hs}).then(j);
const TENANT = prof[0]?.tenant_id, SUP_ID = prof[0]?.id;
ok('supervisor-profile', !!TENANT && !!SUP_ID);

// resident (subject) profile from demo tenant
const res = await fetch(`${URL}/rest/v1/profiles?select=id&tenant_id=eq.${TENANT}&role=eq.resident&limit=1`,{headers:Hs}).then(j);
const RES_ID = res?.[0]?.id;

const patch = (id, body) => fetch(`${URL}/rest/v1/evaluation_forms?id=eq.${id}`,{method:'PATCH',headers:Hs,body:JSON.stringify(body)}).then(async r=>({status:r.status,text:(await r.text()).slice(0,160)}));

// 1. INSERT scratch form as pending (legal)
const ins = await fetch(`${URL}/rest/v1/evaluation_forms?select=id`,{method:'POST',headers:{...Hs,'Prefer':'return=representation'},body:JSON.stringify({
  tenant_id:TENANT, resident_id:RES_ID, evaluator_id:SUP_ID, form_type:'mini_cex',
  encounter_date:'2026-11-01', ratings:{'domains':[{'name':'Clinical','score':4,'max':5}]},
  overall_score:4.0, feedback:'SEC-004 scratch probe', status:'pending'
})}).then(j);
const fid = Array.isArray(ins) ? ins[0]?.id : null;
ok('insert-pending', !!fid, Array.isArray(ins)?fid:JSON.stringify(ins).slice(0,140));

if (fid) {
  // 2. legal: pending -> completed
  const a = await patch(fid, { status: 'completed' });
  ok('pending->completed LEGAL', a.status === 204, `status=${a.status} ${a.text}`);

  // 3. illegal: completed -> pending (backwards)
  const b = await patch(fid, { status: 'pending' });
  ok('completed->pending REJECTED', b.status !== 204, `status=${b.status} ${b.text}`);

  // 4. legal: completed -> acknowledged
  const c = await patch(fid, { status: 'acknowledged' });
  ok('completed->acknowledged LEGAL', c.status === 204, `status=${c.status} ${c.text}`);

  // 5. illegal: acknowledged -> completed (attestation rewrite)
  const d = await patch(fid, { status: 'completed' });
  ok('acknowledged->completed REJECTED', d.status !== 204, `status=${d.status} ${d.text}`);

  // 6. illegal: acknowledged content edit
  const e = await patch(fid, { feedback: 'SEC-004 tamper attempt', overall_score: 5.0 });
  ok('acknowledged content edit REJECTED', e.status !== 204, `status=${e.status} ${e.text}`);

  // 7. illegal: INSERT directly as acknowledged
  const f = await fetch(`${URL}/rest/v1/evaluation_forms?select=id`,{method:'POST',headers:{...Hs,'Prefer':'return=representation'},body:JSON.stringify({
    tenant_id:TENANT, resident_id:RES_ID, evaluator_id:SUP_ID, form_type:'dops',
    encounter_date:'2026-11-01', ratings:{'domains':[{'name':'Technical','score':3,'max':5}]},
    overall_score:3.0, feedback:'SEC-004 insert-bypass probe', status:'acknowledged'
  })});
  const fBody = await f.text();
  ok('insert-as-acknowledged REJECTED', f.status !== 201, `status=${f.status} ${fBody.slice(0,140)}`);

  // cleanup: delete scratch row
  const del = await fetch(`${URL}/rest/v1/evaluation_forms?id=eq.${fid}`,{method:'DELETE',headers:Hs});
  ok('cleanup-delete', del.status === 204 || del.status === 403 || del.status === 405, `status=${del.status} ${(await del.text()).slice(0,120)}`);
}

let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nprobe SEC-004 round2: ${results.length-fails}/${results.length} checks passed`);
