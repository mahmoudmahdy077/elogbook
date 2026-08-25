import { readFileSync } from 'node:fs';
for (const line of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2].replace(/^["']|["']$/g,'')}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const login=async(e)=>fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
const R=await login('resident@demo.com');
await new Promise(r=>setTimeout(r,2500));
const S=await login('supervisor@demo.com'); await new Promise(r=>setTimeout(r,2500));
const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const Hs={'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const prof=await fetch(URL+'/rest/v1/profiles?user_id=eq.'+R.user.id+'&select=id',{headers:Hr}).then(r=>r.json());
const tmpl=await fetch(URL+'/rest/v1/case_templates?select=id&tenant_id=eq.00000000-0000-0000-0000-000000000000&limit=1',{headers:Hr}).then(r=>r.json());
const mk=async(h)=>{const row=await fetch(URL+'/rest/v1/case_entries?select=id',{method:'POST',headers:{...h,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:prof[0].id,template_id:tmpl[0].id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'polmap'},status:'approved',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:null,patient_hash:'x'})}).then(r=>r.json());return Array.isArray(row)?row[0].id:null};
const tomb=(h,id)=>fetch(URL+'/rest/v1/case_entries?id=eq.'+id,{method:'PATCH',headers:h,body:JSON.stringify({deleted_at:new Date().toISOString()})}).then(r=>r.status);

// Case A: created by resident; supervisor tries tombstone (P4 path)
const a=await mk(Hr); console.log('caseA',a?.slice(0,8));
console.log('supervisor tombstones residents case:', await tomb(Hs,a));
// cleanup A via service role regardless
console.log('cleanupA:',(await fetch(URL+'/rest/v1/case_entries?id=eq.'+a,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}})).status);
