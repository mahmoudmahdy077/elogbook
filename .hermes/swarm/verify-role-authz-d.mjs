import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
(async()=>{
 const doLogin=async(e)=>fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
 // create fresh temp user
 const email=`wave4-fix2-${Date.now()}@hospital.org`;
 const nu=await fetch(SB+'/auth/v1/admin/users',{method:'POST',headers:{apikey:SRK,Authorization:'Bearer '+SRK,'Content-Type':'application/json'},body:JSON.stringify({email,password:'Wave4Fix!123',email_confirm:true})}).then(r=>r.json());
 await new Promise(r=>setTimeout(r,2500)); let tp=null; for(let i=0;i<8&&!tp;i++){await new Promise(r=>setTimeout(r,1000)); tp=(await fetch(SB+'/rest/v1/profiles?user_id=eq.'+nu.id+'&select=id,tenant_id',{headers:{apikey:SRK,Authorization:'Bearer '+SRK}}).then(r=>r.json()))[0]??null;} if(tp&&tp.tenant_id!==TENANT){await fetch(SB+'/rest/v1/profiles?id=eq.'+tp.id,{method:'PATCH',headers:{apikey:SRK,Authorization:'Bearer '+SRK,'Content-Type':'application/json'},body:JSON.stringify({tenant_id:TENANT})})} console.log('temp in demo tenant:',tp?.tenant_id===TENANT); const TU=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email,password:'Wave4Fix!123'})}).then(r=>r.json());
 const Ht={'apikey':KEY,'Authorization':'Bearer '+TU.access_token,'Content-Type':'application/json'};
 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${nu.id}&select=id,role`,{headers:Ht}).then(r=>r.json()))[0];
 // admin promotes + reverts
 const AD=await doLogin('admin@demo.com');
 const Had={'apikey':KEY,'Authorization':'Bearer '+AD.access_token,'Content-Type':'application/json'};
 const p1=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:Had,body:JSON.stringify({role:'supervisor'})});
 const r1=(await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}&select=role`,{headers:Had}).then(r=>r.json()))[0]?.role;
 const p2=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:Had,body:JSON.stringify({role:'resident'})});
 const r2=(await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}&select=role`,{headers:Had}).then(r=>r.json()))[0]?.role;
 console.log('[FIX-D] admin promote/revert:',p1.status,r1,'->',p2.status,r2,(r1==='supervisor'&&r2==='resident')?'OK ✓':'BROKEN ✗');
 // director attempts promotion (should be blocked now)
 const DR=await doLogin('director@demo.com');
 const Hd={'apikey':KEY,'Authorization':'Bearer '+DR.access_token,'Content-Type':'application/json'};
 const p3=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:Hd,body:JSON.stringify({role:'supervisor'})});
 console.log('[FIX-E] director promote attempt:',p3.status,p3.status>=400?'BLOCKED ✓ (only inst_admin/admin)':'ALLOWED (by design?)');
 await fetch(SB+'/auth/v1/admin/users/'+nu.id,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
 console.log('[cleanup] done');
})()

