// Native live re-probe: scan_field_values_for_phi MRN branch (migration 20261103000000).
// PASS = MRN 6+ digit insert REJECTED (400, PHI error), date patterns still rejected,
// controls (5-digit, innocent text) accepted. Rejected attempts leave no rows; the
// single accepted control row is tombstoned via rpc/soft_delete_case.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^[\"']|[\"']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (n, c, d = '') => results.push({ n, p: !!c, d });

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const R = await login('resident@demo.com');
const S = await login('supervisor@demo.com');
ok('logins', !!R.access_token && !!S.access_token);
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const j = r => r.json();
const rprof = await fetch(URL+'/rest/v1/profiles?select=id&user_id=eq.'+R.user.id,{headers:Hr}).then(j);
ok('rprof', Array.isArray(rprof)&&!!rprof[0]?.id, JSON.stringify(rprof).slice(0,120));
const tmpl = await fetch(URL+'/rest/v1/case_templates?select=id&tenant_id=in.('+TENANT+',00000000-0000-0000-0000-000000000000)&limit=1',{headers:Hr}).then(j);
ok('template', Array.isArray(tmpl)&&!!tmpl[0]?.id, JSON.stringify(tmpl).slice(0,120));

const pd = new Date().toISOString().split('T')[0];
const payload = fv => JSON.stringify({tenant_id:TENANT,resident_id:rprof[0].id,template_id:tmpl[0].id,case_date:pd,field_values:fv,status:'draft',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:33,patient_hash:'probe-mrn'});
async function post(fv){
  const r = await fetch(URL+'/rest/v1/case_entries',{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:payload(fv)});
  return { status: r.status, body: await j(r) };
}

// 1. MRN probes — must now be REJECTED
let a = await post({mrn:'999999'});
ok('MRN 999999 REJECTED', a.status===400 && /PHI/i.test(JSON.stringify(a.body)), `status=${a.status} ${JSON.stringify(a.body).slice(0,140)}`);
let b = await post({notes:'MRN:999999 mid-string'});
ok('MRN mid-string REJECTED', b.status===400, `status=${b.status} ${JSON.stringify(b.body).slice(0,100)}`);
let c = await post({notes:'id 1234567, END'});
ok('MRN comma-ended REJECTED', c.status===400, `status=${c.status} ${JSON.stringify(c.body).slice(0,100)}`);

// 2. Dates — regression check, must still be rejected
let d = await post({dob:'1990-05-01'});
ok('ISO date REJECTED', d.status===400, `status=${d.status} ${JSON.stringify(d.body).slice(0,100)}`);
let e = await post({dob:'01/05/1990'});
ok('slash date REJECTED', e.status===400, `status=${e.status} ${JSON.stringify(e.body).slice(0,100)}`);

// 3. Controls — must be accepted; clean up
let f = await post({visit:'Follow-up visit in 6 weeks, shot 12345 given'});
ok('5-digit + innocent ACCEPTED', f.status===201, `status=${f.status} ${JSON.stringify(f.body).slice(0,100)}`);
const fId = Array.isArray(f.body)?f.body[0]?.id:null;
if (fId) {
  const del = await fetch(URL+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:fId})}).then(r=>r.status);
  ok('control row cleaned up', del===200||del===204, `soft_delete status=${del} id=${fId}`);
} else {
  ok('control row cleaned up', false, 'no row id to clean');
}

let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nprobe PHI-MRN re-verify: ${results.length-fails}/${results.length} checks passed`);
process.exit(fails?1:0);
