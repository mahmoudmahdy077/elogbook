import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32dec(s){let bits=0,val=0,out=[];for(const c of s.toUpperCase().replace(/=+$/,'')){const idx=B32.indexOf(c);if(idx<0)continue;val=(val<<5)|idx;bits+=5;if(bits>=8){out.push((val>>>(bits-=8))&255)}}return Buffer.from(out)}
function totp(secret){const key=b32dec(secret);const counter=Math.floor(Date.now()/30000);const buf=Buffer.alloc(8);buf.writeUInt32BE(Math.floor(counter/2**32),0);buf.writeUInt32BE(counter>>>0,4);const h=crypto.createHmac('sha1',key).update(buf).digest();const off=h[h.length-1]&15;const code=((h[off]&127)<<24|h[off+1]<<16|h[off+2]<<8|h[off+3])%1000000;return code.toString().padStart(6,'0')}
(async()=>{
 const email=`wave4-fix-${Date.now()}@hospital.org`;
 const nu=await fetch(SB+'/auth/v1/admin/users',{method:'POST',headers:{apikey:SRK,Authorization:'Bearer '+SRK,'Content-Type':'application/json'},body:JSON.stringify({email,password:'Wave4Fix!123',email_confirm:true})}).then(r=>r.json());
 await new Promise(r=>setTimeout(r,2500));
 const login=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email,password:'Wave4Fix!123'})}).then(r=>r.json());
 const H={apikey:KEY,Authorization:'Bearer '+login.access_token,'Content-Type':'application/json'};
 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${nu.id}&select=id,role`,{headers:H}).then(r=>r.json()))[0];

 // A. self->supervisor
 const a=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:H,body:JSON.stringify({role:'supervisor'})});
 console.log('[FIX-A] self->supervisor:',a.status,a.status>=400?'BLOCKED ✓':'ESCALATED ✗');

 // B. enroll + verify MFA (correct endpoints)
 const enr=await fetch(SB+'/auth/v1/factors',{method:'POST',headers:H,body:JSON.stringify({factor_type:'totp',friendly_name:'w4fix'})}).then(r=>r.json());
 const chal=await fetch(`${SB}/auth/v1/factors/${enr.id}/challenge`,{method:'POST',headers:H,body:'{}'}).then(r=>r.json());
 await fetch(`${SB}/auth/v1/factors/${enr.id}/verify`,{method:'POST',headers:H,body:JSON.stringify({code:totp(enr.totp.secret), challenge_id:chal.id})});

 // C. self->director WITH verified MFA
 const d=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:H,body:JSON.stringify({role:'director'})});
 const dRole=(await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}&select=role`,{headers:H}).then(r=>r.json()))[0]?.role;
 console.log('[FIX-C] self->director WITH MFA:',d.status,dRole==='resident'?'BLOCKED ✓':`ESCALATED ✗ (${dRole})`);

 // D. legitimate path still works: admin promotes temp->supervisor->revert
 await new Promise(r=>setTimeout(r,1500));
 const AD=await login('admin@demo.com');
 const Had={'apikey':KEY,'Authorization':'Bearer '+AD.access_token,'Content-Type':'application/json'};
 const p1=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:Had,body:JSON.stringify({role:'supervisor'})});
 const r1=(await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}&select=role`,{headers:Had}).then(r=>r.json()))[0]?.role;
 const p2=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:Had,body:JSON.stringify({role:'resident'})});
 const r2=(await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}&select=role`,{headers:Had}).then(r=>r.json()))[0]?.role;
 console.log('[FIX-D] admin promote/revert:',p1.status,r1,'->',p2.status,r2,(r1==='supervisor'&&r2==='resident')?'OK ✓':'BROKEN ✗');

 await fetch(SB+'/auth/v1/admin/users/'+nu.id,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
 console.log('[cleanup] done');
})()
