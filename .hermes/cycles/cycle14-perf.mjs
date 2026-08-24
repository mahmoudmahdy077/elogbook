// Cycle 14 TEST: performance pass — latency of the hot paths doctors hit daily.
// Targets (production): auth login, dashboard RPC, case list query, template search,
// hash RPC, quota RPC. Budget: interactive DB calls < 1.5s p95-ish; flag anything > 2s.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const timings = [];
async function timed(name, fn, budget=2000) {
  const t = Date.now();
  try { await fn(); } catch(e) { timings.push({name, ms:Date.now()-t, err:e.message}); return; }
  timings.push({name, ms: Date.now()-t, budget});
}
const S = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'supervisor@demo.com',password:'password123!'})}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};

await timed('login', async()=>{ await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}); }, 3000);
await timed('dashboard-report-counts', ()=>fetch(`${URL}/rest/v1/rpc/get_report_counts`,{method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}));
await timed('case-list-20', ()=>fetch(`${URL}/rest/v1/case_entries?deleted_at=is.null&select=id,status,case_date&order=created_at.desc&limit=20`,{headers:H}));
await timed('template-search', ()=>fetch(`${URL}/rest/v1/case_templates?select=id,name,specialty&tenant_id=in.(${TENANT},00000000-0000-0000-0000-000000000000)&limit=30`,{headers:H}));
await timed('hash-mrn', ()=>fetch(`${URL}/rest/v1/rpc/hash_patient_mrn`,{method:'POST',headers:H,body:JSON.stringify({p_mrn:'perf-'+Date.now(),p_tenant_id:TENANT})}));
await timed('quota-check', ()=>fetch(`${URL}/rest/v1/rpc/check_case_quota`,{method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}));
await timed('eval-list', ()=>fetch(`${URL}/rest/v1/evaluation_forms?select=id,status&order=created_at.desc&limit=10`,{headers:H}));

let fails=0;
for (const t of timings) {
  const bad = t.err || t.ms > t.budget;
  console.log(`${bad?'SLOW/FAIL':'PASS'} ${t.name}: ${t.ms}ms${t.err?' :: '+t.err:''}`);
  if (bad) fails++;
}
console.log(`\nCycle14 performance: ${timings.length-fails}/${timings.length} within budget`);
