import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6';
(async()=>{
 const login=async(e)=>fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
 const D=await login('director@demo.com'); await new Promise(r=>setTimeout(r,1500));
 const R=await login('resident@demo.com');
 const Hd={'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
 const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 // register self-receiver webhook as DIRECTOR
 const wid=crypto.randomUUID();
 const reg=await fetch(`${SB}/rest/v1/tenant_webhooks?select=id`,{method:'POST',headers:{...Hd,'Prefer':'return=representation'},body:JSON.stringify({id:wid,tenant_id:TENANT,url:'https://elogbook-web.vercel.app/api/csp-violation',events:['case.approved'],secret:'whsec_w12e2e_'+Date.now(),is_active:true})}).then(r=>r.json());
 console.log('[webhook]',Array.isArray(reg)?reg[0].id:'FAIL '+JSON.stringify(reg).slice(0,100));
 // seed pending case as RESIDENT
 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:Hr}).then(r=>r.json()))[0];
 const tmpl=(await fetch(`${SB}/rest/v1/case_templates?select=id&limit=1`,{headers:Hr}).then(r=>r.json()))[0];
 const c=await fetch(`${SB}/rest/v1/case_entries?select=id,status`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:prof.id,template_id:tmpl.id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'W12 webhook delivery'},status:'pending',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:null,patient_hash:'x'})}).then(r=>r.json());
 console.log('[case]',c[0].id,c[0].status);
 console.log('CASE_ID='+c[0].id);
})()
