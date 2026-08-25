import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const HS={'apikey':KEY,'Authorization':'Bearer '+SRK,'Content-Type':'application/json'};
const login=async(e)=>fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
const R=await login('resident@demo.com'); await new Promise(r=>setTimeout(r,2500));
const D=await login('director@demo.com');
const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const Hd={'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
const rprof=(await fetch(`${URL}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:Hr}).then(r=>r.json()))[0];
// create throwaway second resident via service-role admin
const email=`wave2-probe-${Date.now()}@hospital.org`;
const nu=await fetch(`${URL}/auth/v1/admin/users`,{method:'POST',headers:{apikey:SRK,Authorization:'Bearer '+SRK,'Content-Type':'application/json'},body:JSON.stringify({email,password:'Wave2Probe!123',email_confirm:true})}).then(r=>r.json());
console.log('temp user:',!!nu.id);
// wait for handle_new_user trigger to create profile
let otherId=null; for(let i=0;i<8&&!otherId;i++){await new Promise(r=>setTimeout(r,1000)); const p=await fetch(`${URL}/rest/v1/profiles?user_id=eq.${nu.id}&select=id,tenant_id`,{headers:HS}).then(r=>r.json()); if(p[0]?.id){otherId=p[0].id; if(p[0].tenant_id!==TENANT){await fetch(`${URL}/rest/v1/profiles?id=eq.${otherId}`,{method:'PATCH',headers:HS,body:JSON.stringify({tenant_id:TENANT})})}}}
console.log('second profile:',otherId?.slice(0,8));
const dprof=(await fetch(`${URL}/rest/v1/profiles?user_id=eq.${D.user.id}&select=id`,{headers:Hd}).then(r=>r.json()))[0].id;
const mk=async(rid,h)=>fetch(`${URL}/rest/v1/evaluation_forms?select=id`,{method:'POST',headers:{...h,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:rid,evaluator_id:dprof,form_type:'mini_cex',status:'completed',ratings:{},overall_score:4})}).then(r=>r.json());
const own=await mk(rprof.id,Hd), other=await mk(otherId,Hd);
const ownId=Array.isArray(own)?own[0].id:null, otherIdF=Array.isArray(other)?other[0].id:null;
console.log('seeded:',!!ownId,!!otherIdF);
const seen=await fetch(`${URL}/rest/v1/evaluation_forms?select=id,resident_id&tenant_id=eq.${TENANT}`,{headers:Hr}).then(r=>r.json());
const leaked=seen.filter(x=>x.resident_id!==rprof.id);
console.log('resident sees:',seen.length,'| leaked:',leaked.length, leaked.length===0?'SCOPED-OK':'LEAK!');
const dsee=await fetch(`${URL}/rest/v1/evaluation_forms?select=id&tenant_id=eq.${TENANT}`,{headers:Hd}).then(r=>r.json());
console.log('director sees:',dsee.length,dsee.length>=2?'OK':'MISSING');
for(const id of [ownId,otherIdF]) if(id) await fetch(`${URL}/rest/v1/evaluation_forms?id=eq.${id}`,{method:'DELETE',headers:Hd});
await fetch(`${URL}/auth/v1/admin/users/${nu.id}`,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
console.log('cleanup done');
