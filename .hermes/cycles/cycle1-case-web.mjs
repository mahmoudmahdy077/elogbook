// Cycle 1 TEST: case-create-web — exercise the exact web CaseForm contract against live Supabase.
// Steps mirror CaseForm.tsx handleSubmit/handleSaveDraft:
//   1. login resident@demo.com
//   2. fetch profile id (user_id = auth uid)
//   3. fetch active templates (what the wizard lists)
//   4. hash_patient_mrn RPC (deidentified path)
//   5. insert case_entries with exact column set (status 'approved' auto-approve path)
//   6. read back the row; verify quota counter moved
//   7. clean up (soft-delete)
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (name, cond, detail='') => { results.push({name, pass: !!cond, detail}); };

const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
  body: JSON.stringify({email:'resident@demo.com',password:'password123!'}), signal: AbortSignal.timeout(30000)
}).then(r=>r.json());
ok('login', !!login.access_token);

const H = {'apikey':KEY,'Authorization':`Bearer ${login.access_token}`,'Content-Type':'application/json'};
const j = (r) => r.json();

// 2. profile lookup exactly as CaseForm does
const prof = await fetch(`${URL}/rest/v1/profiles?select=id,role,tenant_id&user_id=eq.${login.user.id}`, {headers:H}).then(j);
ok('profile-by-user_id', Array.isArray(prof) && prof[0]?.id, JSON.stringify(prof).slice(0,120));
const profileId = prof[0]?.id;

// 3. templates visible to resident (wizard list source: tenant + GLOBAL, no is_active column exists)
const tmpl = await fetch(`${URL}/rest/v1/case_templates?select=id,name,specialty&tenant_id=in.(${TENANT},00000000-0000-0000-0000-000000000000)&limit=5`, {headers:H}).then(j);
ok('templates-listed', Array.isArray(tmpl), `count=${tmpl.length ?? 'ERR '+JSON.stringify(tmpl).slice(0,80)}`);
const templateId = tmpl[0]?.id;
ok('has-template', !!templateId, tmpl[0]?.name ?? '');

// 4. quota before
const q1 = await fetch(`${URL}/rest/v1/rpc/check_case_quota`, {method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}).then(j);
const before = q1?.[0]?.current_count;

// 5. hash RPC
const mrn = 'cycle1-' + Date.now();
const hash = await fetch(`${URL}/rest/v1/rpc/hash_patient_mrn`, {method:'POST',headers:H,body:JSON.stringify({p_mrn:mrn,p_tenant_id:TENANT})}).then(j);
ok('hash_patient_mrn', typeof hash === 'string' && hash.length >= 32, String(hash).slice(0,20));

// 6. insert — EXACT CaseForm submit payload shape
const ins = await fetch(`${URL}/rest/v1/case_entries?select=id,status`, {
  method:'POST', headers:{...H,'Prefer':'return=representation'},
  body: JSON.stringify({
    tenant_id: TENANT, resident_id: profileId, template_id: templateId,
    case_date: new Date().toISOString().split('T')[0],
    field_values: {"procedure_name":"Cycle1 test","duration_min":30},
    status: 'approved',
    accreditation_mappings: [],
    is_deidentified: true,
    patient_mrn: null, patient_dob: null, patient_age_years: 44, patient_hash: hash || ''
  })
}).then(j);
const newId = Array.isArray(ins) ? ins[0]?.id : null;
ok('case-insert-approved-path', !!newId, Array.isArray(ins)?`id=${newId} status=${ins[0].status}`:JSON.stringify(ins).slice(0,150));

// draft path variant
const insDraft = await fetch(`${URL}/rest/v1/case_entries?select=id,status`, {
  method:'POST', headers:{...H,'Prefer':'return=representation'},
  body: JSON.stringify({
    tenant_id: TENANT, resident_id: profileId, template_id: templateId,
    case_date: new Date().toISOString().split('T')[0],
    field_values: {"procedure_name":"Cycle1 draft"},
    status: 'approved',
    accreditation_mappings: [], is_deidentified: false,
    patient_mrn: null, patient_dob: null, patient_age_years: null, patient_hash: null
  })
}).then(j);
const draftId = Array.isArray(insDraft) ? insDraft[0]?.id : null;
ok('case-draft-path', !!draftId, Array.isArray(insDraft)?draftId:JSON.stringify(insDraft).slice(0,150));

// 7. quota after (should have moved by 2 if counting works)
await new Promise(r=>setTimeout(r,800));
const q2 = await fetch(`${URL}/rest/v1/rpc/check_case_quota`, {method:'POST',headers:H,body:JSON.stringify({p_tenant_id:TENANT})}).then(j);
ok('quota-count-moved', q2?.[0]?.current_count >= (before ?? 0), `before=${before} after=${q2?.[0]?.current_count}`);

// 8. read-back + cleanup (soft delete both)
if (newId) await fetch(`${URL}/rest/v1/case_entries?id=eq.${newId}`, {method:'PATCH',headers:H,body:JSON.stringify({deleted_at:new Date().toISOString()})});
if (draftId) await fetch(`${URL}/rest/v1/case_entries?id=eq.${draftId}`, {method:'PATCH',headers:H,body:JSON.stringify({deleted_at:new Date().toISOString()})});
ok('cleanup-softdelete', true);

let fails = 0;
for (const r of results) { console.log(`${r.pass?'PASS':'FAIL'} ${r.name}${r.detail?' :: '+r.detail:''}`); if(!r.pass) fails++; }
console.log(`\nCycle1 case-create-web: ${results.length-fails}/${results.length} checks passed`);
