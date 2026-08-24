// Cycle 13 TEST: reports CSV exports (status.csv + specialty.csv contracts) + settings/profile
// CSV routes query case_entries server-side; test the DB queries they run + CSV shape via RPC
// equivalent. Also profile update path (full_name change + revert).
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
const H = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};

// status.csv contract: select id,status,case_date for tenant non-deleted, then CSV rows
const rows = await fetch(`${URL}/rest/v1/case_entries?tenant_id=eq.${TENANT}&deleted_at=is.null&select=id,status,case_date&order=created_at.asc`,{headers:H}).then(r=>r.json());
ok('status-csv-query', Array.isArray(rows), `rows=${rows.length}`);
const csv = ['id,status,case_date', ...rows.map(r=>`${r.id},${r.status},${r.case_date}`)].join('\\n');
ok('csv-shape-valid', csv.split('\\n').length===rows.length+1 && !csv.includes('null,'), `${rows.length+1} lines`);

// specialty.csv needs template join: verify templates resolvable for all cases
const tmpl = await fetch(`${URL}/rest/v1/case_templates?select=id,specialty&tenant_id=in.(${TENANT},00000000-0000-0000-0000-000000000000)`,{headers:H}).then(r=>r.json());
const tmap = new Map(tmpl.map(t=>[t.id,t.specialty]));
const casesTmpl = await fetch(`${URL}/rest/v1/case_entries?tenant_id=eq.${TENANT}&deleted_at=is.null&select=template_id&limit=200`,{headers:H}).then(r=>r.json());
const missingSpec = casesTmpl.filter(c=>!tmap.has(c.template_id)).length;
ok('specialty-join-complete', missingSpec===0, `missing=${missingSpec}/${casesTmpl.length}`);

// profile update: full_name change + revert (settings-profile slice)
const me = await fetch(`${URL}/rest/v1/profiles?select=id,full_name&user_id=eq.${S.user.id}`,{headers:H}).then(r=>r.json());
const origName = me[0].full_name;
let upd = {};
{
  const rr = await fetch(`${URL}/rest/v1/profiles?id=eq.${me[0].id}`,{method:'PATCH',headers:H,body:JSON.stringify({full_name:'Cycle13 Test'})});
  if (rr.status !== 204) { try { upd = await rr.json(); } catch {} }
}
const after = await fetch(`${URL}/rest/v1/profiles?id=eq.${me[0].id}&select=full_name`,{headers:H}).then(r=>r.json());
ok('profile-update-works', !upd.code && after[0]?.full_name==='Cycle13 Test', JSON.stringify(upd).slice(0,80));
await fetch(`${URL}/rest/v1/profiles?id=eq.${me[0].id}`,{method:'PATCH',headers:H,body:JSON.stringify({full_name:origName})});
const rev = await fetch(`${URL}/rest/v1/profiles?id=eq.${me[0].id}&select=full_name`,{headers:H}).then(r=>r.json());
ok('profile-reverted', rev[0]?.full_name===origName);

let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nCycle13 reports+profile: ${results.length-fails}/${results.length} checks passed`);
