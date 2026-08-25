import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32dec(s){let bits=0,val=0,out=[];for(const c of s.toUpperCase().replace(/=+$/,'')){const idx=B32.indexOf(c);if(idx<0)continue;val=(val<<5)|idx;bits+=5;if(bits>=8){out.push((val>>>(bits-=8))&255)}}return Buffer.from(out)}
function totp(secret){const key=b32dec(secret);const counter=Math.floor(Date.now()/30000);const buf=Buffer.alloc(8);buf.writeUInt32BE(Math.floor(counter/2**32),0);buf.writeUInt32BE(counter>>>0,4);const h=crypto.createHmac('sha1',key).update(buf).digest();const off=h[h.length-1]&15;const code=((h[off]&127)<<24|h[off+1]<<16|h[off+2]<<8|h[off+3])%1000000;return code.toString().padStart(6,'0')}
(async()=>{
 const email=`wave4-mfa-${Date.now()}@hospital.org`;
 const nu=await fetch(SB+'/auth/v1/admin/users',{method:'POST',headers:{apikey:SRK,Authorization:'Bearer '+SRK,'Content-Type':'application/json'},body:JSON.stringify({email,password:'Wave4Mfa!123',email_confirm:true})}).then(r=>r.json());
 console.log('[setup] temp user:',!!nu.id);
 await new Promise(r=>setTimeout(r,2500));
 const login=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email,password:'Wave4Mfa!123'})}).then(r=>r.json());
 const H={apikey:KEY,Authorization:'Bearer '+login.access_token,'Content-Type':'application/json'};
 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${nu.id}&select=id,role`,{headers:H}).then(r=>r.json()))[0];
 console.log('[1] login+profile:',prof.role);

 // A. resident -> supervisor (no MFA involved)
 const a=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:H,body:JSON.stringify({role:'supervisor'})});
 const aRole=(await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}&select=role`,{headers:H}).then(r=>r.json()))[0]?.role;
 console.log('[A] self->supervisor:',a.status,aRole==='supervisor'?'ESCALATED ✗':'blocked');

 // revert if escalated
 if(aRole==='supervisor') await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:H,body:JSON.stringify({role:'resident'})});

 // B. enroll TOTP via CORRECT endpoint POST /factors
 const enr=await fetch(SB+'/auth/v1/factors',{method:'POST',headers:H,body:JSON.stringify({factor_type:'totp',friendly_name:'w4'})}).then(r=>r.json());
 console.log('[B] enroll /factors:',enr.id?'OK':JSON.stringify(enr).slice(0,120));
 if(!enr.id){ // fallback legacy path
   const enr2=await fetch(SB+'/auth/v1/mfa/factors',{method:'POST',headers:H,body:JSON.stringify({factor_type:'totp'})}).then(r=>r.json());
   console.log('[B2] legacy path:',JSON.stringify(enr2).slice(0,120));
 }
 const fid=enr.id; const secret=enr.totp?.secret;
 // challenge+verify
 const chal=await fetch(`${SB}/auth/v1/factors/${fid}/challenge`,{method:'POST',headers:H,body:'{}'}).then(r=>r.json());
 const code=totp(secret);
 const ver=await fetch(`${SB}/auth/v1/factors/${fid}/verify`,{method:'POST',headers:H,body:JSON.stringify({code, challenge_id:chal.id})}).then(r=>r.json());
 console.log('[C] verify:',ver.user?.id?`VERIFIED (${ver.status??''})`:JSON.stringify(ver).slice(0,140));

 // D. THE ESCALATION: self->director WITH verified MFA
 const d=await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}`,{method:'PATCH',headers:H,body:JSON.stringify({role:'director'})});
 const dRole=(await fetch(`${SB}/rest/v1/profiles?id=eq.${prof.id}&select=role`,{headers:H}).then(r=>r.json()))[0]?.role;
 console.log('[D] self->director WITH MFA:',d.status,dRole==='director'?'*** ESCALATED ✗ P1 ***':'blocked ✓');

 // cleanup: delete factors + user
 await fetch(`${SB}/auth/v1/admin/users/${nu.id}`,{method:'DELETE',headers:{apikey:SRK,Authorization:'Bearer '+SRK}});
 console.log('[cleanup] temp user deleted');
})()
