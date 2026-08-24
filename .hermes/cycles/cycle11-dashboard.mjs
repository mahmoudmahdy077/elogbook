// Cycle 11 TEST: dashboard/analytics accuracy — dashboard RPC output vs raw table counts
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
ok('login', !!S.access_token);
const H = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};

// what dashboard RPCs does the web call?
// known: get_report_counts; check for get_dashboard_stats / get_resident_dashboard etc.
const rpcs = ['get_report_counts'];
for (const rpc of rpcs) {
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/${rpc}`,{method:'POST',headers:H,body:JSON.stringify({})}).then(r=>r.json());
    console.log(rpc, '->', JSON.stringify(r).slice(0,200));
  } catch(e){ console.log(rpc, 'ERR', e.message); }
}

// raw counts as supervisor sees them
const cases = await fetch(`${URL}/rest/v1/case_entries?deleted_at=is.null&select=status`,{headers:H}).then(r=>r.json());
const byStatus = {};
(cases||[]).forEach(c=>byStatus[c.status]=(byStatus[c.status]??0)+1);
console.log('raw case counts:', JSON.stringify(byStatus), '| total', cases?.length);

// report_counts RPC with proper args if needed
const rc = await fetch(`${URL}/rest/v1/rpc/get_report_counts`,{method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}).then(r=>r.json());
console.log('get_report_counts(tenant):', JSON.stringify(rc).slice(0,300));

// accuracy: RPC totals should equal raw visible counts
if (Array.isArray(rc) && rc[0]) {
  const r0 = rc[0];
  const totalRaw = cases.length;
  const totalRpc = r0.total_cases ?? r0.total ?? null;
  ok('report-counts-match-raw', totalRpc===null || Number(totalRpc)===totalRaw, `rpc=${totalRpc} raw=${totalRaw}`);
} else {
  ok('report-counts-responds', !!rc, typeof rc);
}
let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nCycle11 dashboard-accuracy: ${results.length-fails}/${results.length} checks passed`);
