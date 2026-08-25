import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const R=await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
const H={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const prof=await fetch(URL+'/rest/v1/profiles?user_id=eq.'+R.user.id+'&select=id',{headers:H}).then(r=>r.json());
const tmpl=await fetch(URL+'/rest/v1/case_templates?select=id&tenant_id=eq.00000000-0000-0000-0000-000000000000&limit=1',{headers:H}).then(r=>r.json());
const mk=await fetch(URL+'/rest/v1/case_entries?select=id',{method:'POST',headers:{...H,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:prof[0].id,template_id:tmpl[0].id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'bisect'},status:'draft',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:null,patient_hash:'x'})}).then(r=>r.json());
const id=Array.isArray(mk)?mk[0].id:null; console.log('draft:',id?.slice(0,8));
const e1=await fetch(URL+'/rest/v1/case_entries?id=eq.'+id,{method:'PATCH',headers:H,body:JSON.stringify({field_values:{procedure_name:'bisect-edited'}})});
console.log('draft content edit:',e1.status,e1.status===204?'OK':'BLOCKED '+JSON.stringify(await e1.json()).slice(0,120));
const e2=await fetch(URL+'/rest/v1/case_entries?id=eq.'+id,{method:'PATCH',headers:H,body:JSON.stringify({deleted_at:new Date().toISOString()})});
console.log('draft tombstone:',e2.status,e2.status===204?'OK':'BLOCKED');
if(e2.status!==204){console.log('cleanup',(await fetch(URL+'/rest/v1/case_entries?id=eq.'+id,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}})).status)}
