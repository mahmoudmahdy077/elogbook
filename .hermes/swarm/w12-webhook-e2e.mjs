// W12: webhook delivery E2E — register self-receiver, approve case, verify delivery row
import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const login=async(e)=>fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
(async()=>{
 const R=await login('resident@demo.com'); await new Promise(r=>setTimeout(r,1500));
 const S=await login('supervisor@demo.com');
 const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 const Hs={'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};

 // 1. register webhook -> our own csp-violation endpoint (accepts any JSON, 204)
 
 const D=await login('director@demo.com'); await new Promise(r=>setTimeout(r,1500));
 const Hd={'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
 const wid=crypto.randomUUID();
 const reg=await fetch(`${SB}/rest/v1/tenant_webhooks?select=id`,{method:'POST',headers:{...Hd,'Prefer':'return=representation'},body:JSON.stringify({id:wid,tenant_id:TENANT,url:'https://elogbook-web.vercel.app/api/csp-violation',events:['case.approved'],secret:'whsec_w5e2e_'+Date.now(),is_active:true})}).then(r=>r.json());
 console.log('[register]',Array.isArray(reg)?'OK '+reg[0].id.slice(0,8):JSON.stringify(reg).slice(0,120));

 // 2. seed pending case + supervisor approves via UI-equivalent API route (fires dispatchWebhookEvent)
 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:Hr}).then(r=>r.json()))[0];
 const tmpl=(await fetch(`${SB}/rest/v1/case_templates?select=id&limit=1`,{headers:Hr}).then(r=>r.json()))[0];
 const cid=(await fetch(`${SB}/rest/v1/case_entries?select=id`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:prof.id,template_id:tmpl.id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'w12-webhook'},status:'pending',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:null,patient_hash:'x'})}).then(r=>r.json()))[0].id;
 // approve through the Next.js API route (this is the path that calls dispatchWebhookEvent)
 const act=await fetch(`${PROD||''}`.length? 'https://elogbook-web.vercel.app'+`/api/demo/approvals/action`:`https://elogbook-web.vercel.app/api/demo/approvals/action`,{method:'POST',headers:Hr,body:JSON.stringify({entry_id:cid,action:'approve',comment:'w12'})});
 console.log('[approve via route]',act.status,(await act.text()).slice(0,80));

 // 3. poll deliveries for our webhook
 let found=null;
 for(let i=0;i<6;i++){
   await new Promise(r=>setTimeout(r,3000));
   const d=await fetch(`${SB}/rest/v1/tenant_webhook_deliveries?webhook_id=eq.${wid}&select=id,status_code,created_at&order=created_at.desc&limit=3`,{headers:Hr}).then(r=>r.json());
   if(Array.isArray(d)&&d.length){found=d;break}
 }
 console.log('[deliveries]',found?JSON.stringify(found):'none recorded');
 if(!found) console.log('(dispatch may be async via queue; checking retry queue)');
 const q=await fetch(`${SB}/rest/v1/webhook_retry_queue?webhook_id=eq.${wid}&select=*`,{headers:Hr}).then(r=>r.json()).catch(()=>null);
 if(q) console.log('[retry queue]',JSON.stringify(q).slice(0,150));

 // cleanup
 await fetch(`${SB}/rest/v1/tenant_webhooks?id=eq.${wid}`,{method:'DELETE',headers:Hr});
 await fetch(`${SB}/rest/v1/case_entries?id=eq.${cid}`,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
 console.log('cleanup done');
})()

