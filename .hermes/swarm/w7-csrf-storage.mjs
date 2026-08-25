// W7 security depth: CSRF live checks + storage cross-tenant isolation
import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD='https://elogbook-web.vercel.app';
(async()=>{
 // ── CSRF: state-changing request WITHOUT same-origin header must be rejected by proxy csrfGuard
 // Use a real session against PROD; POST to a tenant API route with Origin: https://evil.example
 const R=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
 const csrfTests=[
   ['no-origin', {}],
   ['cross-origin', {'Origin':'https://evil.example'}],
 ];
 for(const [tag,extra] of csrfTests){
   const res=await fetch(`${PROD}/api/demo/admin/invite`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+R.access_token,...extra},body:JSON.stringify({email:'victim@x.com'})});
   console.log(`[CSRF ${tag}]`,res.status,res.status>=400&&res.status<500?'rejected ✓':'CHECK');
 }

 // ── Storage cross-tenant: resident of demo tries upload into other-tenant folder path
 const up=await fetch(SB+'/storage/v1/object/case-attachments/other-tenant/probe.txt',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+R.access_token,'Content-Type':'text/plain'},body:'x'});
 console.log('[storage cross-tenant upload]',up.status,up.status>=400?'BLOCKED ✓':'ALLOWED ✗');

 // ── Storage signed-URL for another tenant's object (guess path) must fail
 const sign=await fetch(`${SB}/storage/v1/object/sign/case-attachments/other-tenant/whatever.txt`,{method:'POST',headers:{apikey:KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})});
 console.log('[storage cross-tenant sign]',sign.status,sign.status>=400?'BLOCKED ✓':'CHECK');
})()
