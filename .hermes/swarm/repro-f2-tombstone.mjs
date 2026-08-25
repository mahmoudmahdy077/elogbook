import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const R = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const prof = await fetch(`${URL}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:H}).then(r=>r.json());
// global surgery template
const tmpl = await fetch(`${URL}/rest/v1/case_templates?select=id&tenant_id=eq.00000000-0000-0000-0000-000000000000&limit=1`,{headers:H}).then(r=>r.json());
const hash = await fetch(`${URL}/rest/v1/rpc/hash_patient_mrn`,{method:'POST',headers:H,body:JSON.stringify({p_mrn:'F2PROBE-'+Date.now(),p_tenant_id:TENANT})}).then(r=>r.text());
const ins = await fetch(`${URL}/rest/v1/case_entries?select=id,status`,{method:'POST',headers:{...H,'Prefer':'return=representation'},body:JSON.stringify({
  tenant_id:TENANT, resident_id:prof[0].id, template_id:tmpl[0].id, case_date:new Date().toISOString().split('T')[0],
  field_values:{procedure_name:'F2 repro'}, status:'approved', accreditation_mappings:[], is_deidentified:true,
  patient_mrn:null, patient_dob:null, patient_age_years:null, patient_hash:String(hash).replace(/"/g,'')
})}).then(r=>r.json());
const id = Array.isArray(ins) ? ins[0].id : null;
console.log('created approved case:', id ?? JSON.stringify(ins));
if (!id) process.exit(1);

// THE PROBE: resident soft-delete own approved case via REST
const patch = await fetch(`${URL}/rest/v1/case_entries?id=eq.${id}`,{method:'PATCH',headers:H,body:JSON.stringify({deleted_at:new Date().toISOString()})});
console.log('REST tombstone approved:', patch.status, patch.status===204?'WORKS ✓':'BLOCKED');
if (patch.status!==204) console.log(await patch.text());
// cleanup if it worked
if (patch.status===204) {
  const SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const del=await fetch(`${URL}/rest/v1/case_entries?id=eq.${id}`,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
  console.log('hard cleanup:', del.status);
}
