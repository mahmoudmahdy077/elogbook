// Cycle 9 TEST: evaluations — verify both former P1s are truly fixed against LIVE DB.
// Web MiniCEX contract: form_type 'mini_cex', status 'completed', ratings/overall_score/feedback
// Mobile contract: form_type from shared list, status 'pending', empty ratings
// Also RBAC: resident should be able to insert own eval? (mobile allows residents to create)
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
ok('logins', !!S.access_token && !!R.access_token);
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};

const sprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${S.user.id}`,{headers:Hs}).then(r=>r.json());
const rprof = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${R.user.id}`,{headers:Hr}).then(r=>r.json());

// WEB MiniCEX path (supervisor evaluates resident)
const webPayload = {
  tenant_id:TENANT, resident_id:rprof[0].id, evaluator_id:sprof[0].id,
  form_type:'mini_cex',
  ratings:{domains:[{name:'Clinical',key:'clinical',score:4,max:9}]},
  overall_score:4.2, feedback:'cycle9 web test', status:'completed'
};
let res = await fetch(`${URL}/rest/v1/evaluation_forms?select=id,status,form_type`,{method:'POST',headers:{...Hs,'Prefer':'return=representation'},body:JSON.stringify(webPayload)}).then(r=>r.json());
const webId = Array.isArray(res)?res[0]?.id:null;
ok('web-minicex-insert', !!webId, Array.isArray(res)?`${res[0].form_type}/${res[0].status}`:JSON.stringify(res).slice(0,120));

// MOBILE path (supervisor creates pending eval via app)
const mobPayload = {
  tenant_id:TENANT, resident_id:rprof[0].id, evaluator_id:sprof[0].id,
  form_type:'dops', encounter_date:null, setting:null, ratings:{}, status:'pending'
};
res = await fetch(`${URL}/rest/v1/evaluation_forms?select=id,status,form_type`,{method:'POST',headers:{...Hs,'Prefer':'return=representation'},body:JSON.stringify(mobPayload)}).then(r=>r.json());
const mobId = Array.isArray(res)?res[0]?.id:null;
ok('mobile-eval-pending-insert', !!mobId, Array.isArray(res)?`${res[0].form_type}/${res[0].status}`:JSON.stringify(res).slice(0,120));

// invalid form_type must be rejected by CHECK (procedure_log was the old mobile bug)
res = await fetch(`${URL}/rest/v1/evaluation_forms`,{method:'POST',headers:Hs,body:JSON.stringify({...mobPayload, form_type:'procedure_log'})}).then(r=>r.json());
ok('check-constraint-blocks-procedure_log', res?.code==='23514', JSON.stringify(res).slice(0,90));

// resident visibility: resident reads evaluations about them
if (webId) {
  const vis = await fetch(`${URL}/rest/v1/evaluation_forms?id=eq.${webId}&select=id`,{headers:Hr}).then(r=>r.json());
  ok('resident-can-view-own-eval', Array.isArray(vis)&&vis.length===1);
}

// cleanup
for (const id of [webId, mobId]) if (id) await fetch(`${URL}/rest/v1/evaluation_forms?id=eq.${id}`,{method:'DELETE',headers:Hs});
ok('cleanup', true);

let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nCycle9 evaluations: ${results.length-fails}/${results.length} checks passed`);
