import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
(async()=>{
 const R=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
 const H={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:H}).then(r=>r.json()))[0];
 const tmpl=(await fetch(`${SB}/rest/v1/case_templates?select=id&limit=1`,{headers:H}).then(r=>r.json()))[0];
 const cid=(await fetch(`${SB}/rest/v1/case_entries?select=id`,{method:'POST',headers:{...H,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:prof.id,template_id:tmpl.id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'att-del-verify'},status:'approved',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:null,patient_hash:'x'})}).then(r=>r.json()))[0].id;
 const aid=crypto.randomUUID();
 const ins=await fetch(`${SB}/rest/v1/case_attachments?select=id`,{method:'POST',headers:{...H,'Prefer':'return=representation'},body:JSON.stringify({id:aid,tenant_id:TENANT,entry_id:cid,file_path:`demo/verify/${aid}.txt`,file_type:'text/plain',uploaded_by:prof.id})});
 console.log('insert:',ins.status);
 const del=await fetch(`${SB}/rest/v1/case_attachments?id=eq.${aid}`,{method:'DELETE',headers:H});
 console.log('resident DELETE own attachment:',del.status,del.status===204?'OK ✓':'STILL BLOCKED ✗');
 const gone=await fetch(`${SB}/rest/v1/case_attachments?id=eq.${aid}&select=id`,{headers:H}).then(r=>r.json());
 console.log('row really gone:',gone.length===0?'✓':'✗ still present');
 // cleanup case
 await fetch(`${SB}/rest/v1/case_entries?id=eq.${cid}`,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
 console.log('cleanup done');
})()
