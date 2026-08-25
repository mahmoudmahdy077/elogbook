import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const login=async(e)=>fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
(async()=>{
 const R=await login('resident@demo.com'); await new Promise(r=>setTimeout(r,2000));
 const S=await login('supervisor@demo.com');
 const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 const Hs={'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};

 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:Hr}).then(r=>r.json()))[0];
 const tmpl=(await fetch(`${SB}/rest/v1/case_templates?select=id&limit=1`,{headers:Hr}).then(r=>r.json()))[0];
 const c=await fetch(`${SB}/rest/v1/case_entries?select=id`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:prof.id,template_id:tmpl.id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'w3-storage'},status:'approved',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:null,patient_hash:'x'})}).then(r=>r.json());
 const cid=Array.isArray(c)?c[0].id:null;
 console.log('[seed case]',cid?.slice(0,8));

 const aid=crypto.randomUUID();
 const path=`w3/${aid}.txt`;
 const ins=await fetch(`${SB}/rest/v1/case_attachments?select=id`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({id:aid, tenant_id:TENANT, entry_id:cid, file_path:path, file_type:'text/plain'})});
 console.log('[attach row insert]',ins.status);
 const insBody=ins.ok?(await ins.json())[0]?.id:null;

 // object upload into private bucket
 const up=await fetch(`${SB}/storage/v1/object/case-attachments/${path}`,{method:'POST',headers:{apikey:KEY,Authorization:Hr.Authorization,'Content-Type':'text/plain','x-upsert':'true'},body:'hello-wave3'});
 const upBody=await up.text();
 console.log('[object upload]',up.status,up.ok?'OK':upBody.slice(0,110));

 // resident reads own attachment metadata
 const ownRead=await fetch(`${SB}/rest/v1/case_attachments?id=eq.${insBody||aid}&select=id,file_path`,{headers:Hr}).then(r=>r.json());
 console.log('[resident meta read]',Array.isArray(ownRead)?ownRead.length+' row(s)':'ERR');

 // supervisor reads tenant metadata
 const supRead=await fetch(`${SB}/rest/v1/case_attachments?id=eq.${insBody||aid}&select=id,file_path`,{headers:Hs}).then(r=>r.json());
 console.log('[supervisor meta read]',Array.isArray(supRead)?supRead.length+' row(s)':'ERR');

 // signed URL for private object
 if(up.ok){
  const sign=await fetch(`${SB}/storage/v1/object/sign/case-attachments/${path}`,{method:'POST',headers:{apikey:KEY,Authorization:Hr.Authorization,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})}).then(r=>r.json());
  console.log('[signed url]',sign.signedURL?'OK ✓':JSON.stringify(sign).slice(0,110));
 }

 // cleanup
 await fetch(`${SB}/storage/v1/object/case-attachments/${path}`,{method:'DELETE',headers:{apikey:KEY,Authorization:Hr.Authorization}});
 await fetch(`${SB}/rest/v1/case_attachments?id=eq.${insBody||aid}`,{method:'DELETE',headers:Hs});
 await fetch(`${SB}/rest/v1/case_entries?id=eq.${cid}`,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
 console.log('cleanup done');
})()
