import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const login=async(e)=>fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
(async()=>{
 const R=await login('resident@demo.com'); await new Promise(r=>setTimeout(r,2000));
 const S=await login('supervisor@demo.com');
 const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 const Hs={'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
 const prof=(await fetch(SB+'/rest/v1/profiles?user_id=eq.'+R.user.id+'&select=id',{headers:Hr}).then(r=>r.json()))[0];
 const tmpl=(await fetch(SB+'/rest/v1/case_templates?select=id&limit=1',{headers:Hr}).then(r=>r.json()))[0];
 const mk=async(h,st)=>fetch(SB+'/rest/v1/case_entries?select=id',{method:'POST',headers:{...h,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:prof.id,template_id:tmpl.id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'rpc-sd-test'},status:st,accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:null,patient_hash:'x'})}).then(r=>r.json());
 const c1=await mk(Hr,'approved'); const id1=Array.isArray(c1)?c1[0].id:null;
 console.log('created approved:',id1?.slice(0,8));
 const sd=await fetch(SB+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hr,body:JSON.stringify({p_entry_id:id1})}).then(r=>r.json());
 console.log('resident RPC delete own approved:',JSON.stringify(sd), sd.success?'OK':'FAIL');
 const c2=await mk(Hr,'pending'); const id2=Array.isArray(c2)?c2[0].id:null;
 const sd2=await fetch(SB+'/rest/v1/rpc/soft_delete_case',{method:'POST',headers:Hs,body:JSON.stringify({p_entry_id:id2})}).then(r=>r.json());
 console.log('supervisor RPC delete pending:',JSON.stringify(sd2), sd2.success?'OK':'FAIL');
 for(const id of [id1,id2]) await fetch(SB+'/rest/v1/case_entries?id=eq.'+id,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
 console.log('cleanup done');
})()
