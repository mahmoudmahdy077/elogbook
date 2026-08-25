// P1-candidate repro: can resident MODIFY another resident's evaluation form?
import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
(async()=>{
 const login=async(e)=>fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
 const R=await login('resident@demo.com'); await new Promise(r=>setTimeout(r,1500));
 const D=await login('director@demo.com');
 const Hr={'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 const Hd={'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
 const rprof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:Hr}).then(r=>r.json()))[0];
 const dprof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${D.user.id}&select=id`,{headers:Hd}).then(r=>r.json()))[0];

 // seed: director creates an evaluation for the SAME resident (so it's "own" by subject)
 const ins=await fetch(`${SB}/rest/v1/evaluation_forms?select=id`,{method:'POST',headers:{...Hd,'Prefer':'return=representation'},body:JSON.stringify({tenant_id:TENANT,resident_id:rprof.id,evaluator_id:dprof.id,form_type:'mini_cex',status:'completed',ratings:{},overall_score:3.5})}).then(r=>r.json());
 const eid=Array.isArray(ins)?ins[0].id:null;
 console.log('[seed] own-subject eval:',eid?.slice(0,8));

 // ABUSE TEST: resident PATCHes overall_score on that eval (subject ≠ evaluator)
 const patch=await fetch(`${SB}/rest/v1/evaluation_forms?id=eq.${eid}`,{method:'PATCH',headers:Hr,body:JSON.stringify({overall_score:5})});
 console.log('[abuse] resident PATCH others-eval score:',patch.status,patch.status===204?'*** ALLOWED ✗ P1 ***':(await patch.text()).slice(0,80));

 // verify persisted value
 const after=await fetch(`${SB}/rest/v1/evaluation_forms?id=eq.${eid}&select=overall_score`,{headers:Hd}).then(r=>r.json());
 console.log('[after] overall_score:',after[0]?.overall_score);

 // cleanup
 await fetch(`${SB}/rest/v1/evaluation_forms?id=eq.${eid}`,{method:'DELETE',headers:Hd});
 console.log('cleanup done');
})()
