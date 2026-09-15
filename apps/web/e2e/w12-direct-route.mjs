// Direct route test: supervisor session approves TARGET via /approvals/action
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const Hs={'apikey':SRK,'Authorization':'Bearer '+SRK,'Content-Type':'application/json'};
const WID='fec65687-ac20-4a86-b3fb-24eb0ce54aa3';
const TARGET='70746fc0-0f9d-454d-8d37-0ed08c3bdc34';
(async()=>{
 const before=await fetch(SB+'/rest/v1/tenant_webhook_deliveries?webhook_id=eq.'+WID,{headers:Hs}).then(r=>r.json());
 console.log('deliveries BEFORE:',Array.isArray(before)?before.length:before);
 const S=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'supervisor@demo.com',password:'password123!'})}).then(r=>r.json());
 const ref=SB.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)[1];
 const tokenValue=JSON.stringify({access_token:S.access_token,refresh_token:S.refresh_token,expires_in:S.expires_in??3600,expires_at:S.expires_at??Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:S.user});
 const browser=await chromium.launch();
 const ctx=await browser.newContext();
 await ctx.addCookies([{name:`sb-${ref}-auth-token`,value:'base64-'+Buffer.from(tokenValue).toString('base64'),url:'https://elogbook-web.vercel.app',httpOnly:false,sameSite:'Lax'}]);
 // seed fresh pending case as resident first
 const R=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
 const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:Hr}).then(r=>r.json()))[0];
 const tmpl=(await fetch(`${SB}/rest/v1/case_templates?select=id&limit=1`,{headers:Hr}).then(r=>r.json()))[0];
 const cid=(await fetch(`${SB}/rest/v1/case_entries?select=id`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:prof.id,template_id:tmpl.id,case_date:new Date().toISOString().split('T')[0],field_values:{procedure_name:'w12-after-fix'},status:'pending',accreditation_mappings:[],is_deidentified:true,patient_mrn:null,patient_dob:null,patient_age_years:null,patient_hash:'x'})}).then(r=>r.json()))[0].id;
 console.log('[fresh pending]',cid.slice(0,8));
 const res=await ctx.request.post('https://elogbook-web.vercel.app/api/demo/approvals/action',{
   headers:{'Origin':'https://elogbook-web.vercel.app'},
   data:{action:'approve',entry_id:cid,comment:'w12 after() verification'}
 });
 console.log('[route]',res.status(),(await res.text()).slice(0,120));
 await page0wait(6000);
 async function page0wait(ms){await new Promise(r=>setTimeout(r,ms))}
 const d=await fetch(SB+'/rest/v1/tenant_webhook_deliveries?webhook_id=eq.'+WID,{headers:Hs}).then(r=>r.json());
 console.log('deliveries AFTER:',JSON.stringify(d).slice(0,500));
 const st=await fetch(SB+'/rest/v1/case_entries?id=eq.'+cid+'&select=status',{headers:Hs}).then(r=>r.json());
 console.log('case status:',JSON.stringify(st));
 await browser.close();
})()
