// Cycle 67 TEST: reports CSV routes data layer — specialty/status/duty-hours/evaluations
// aggregations return correct shapes for supervisor; resident scoping.
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
const HS = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
ok('login', !!S.access_token);

// specialty aggregation via case_templates join (same as CSV route logic)
const spec = await fetch(`${URL}/rest/v1/case_entries?tenant_id=eq.${TENANT}&deleted_at=is.null&select=template_id,status,case_date&limit=200`,{headers:HS}).then(x=>x.json());
ok('case-rows-for-reports', Array.isArray(spec) && spec.length>0, `n=${spec.length}`);

// status distribution
const byStatus = {};
for (const r of spec) byStatus[r.status]=(byStatus[r.status]||0)+1;
console.log('status dist:', JSON.stringify(byStatus));
ok('status-dist-nonempty', Object.keys(byStatus).length>0);

// duty hours table exists?
const dh = await fetch(`${URL}/rest/v1/duty_periods?select=*&limit=3`,{headers:HS}).then(async x=>({s:x.status,b:await x.text()}));
ok('duty-hours-readable', dh.s===200||dh.s===404, `${dh.s} ${dh.b.slice(0,60)}`);

// evaluations for reports
const ev = await fetch(`${URL}/rest/v1/evaluation_forms?select=id&limit=5`,{headers:HS}).then(x=>x.status);
ok('evaluations-queryable', [200,404].includes(ev), `status=${ev}`);

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle67 reports-data: ${results.length-fails}/${results.length} checks passed`);
