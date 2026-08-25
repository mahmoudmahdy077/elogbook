// W7: IDOR sweep — resident probes id-bearing admin/template routes with
// crafted UUIDs; every response must be 4xx (never 2xx leaking data)
import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROD='https://elogbook-web.vercel.app';
(async()=>{
 const R=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
 const H={apikey:KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 const fake='00000000-0000-0000-0000-00000000dead';
 const probes=[
  ['GET','/api/demo/templates/'+fake],
  ['PATCH','/api/demo/templates/'+fake],
  ['DELETE','/api/demo/templates/'+fake],
  ['POST','/api/demo/templates/'+fake+'/duplicate'],
  ['GET','/api/demo/templates/export/'+fake],
  ['POST','/api/demo/admin/users/'+fake+'/action'],
  ['GET','/api/demo/admin/users/'+fake],
 ];
 let leaks=0;
 for(const [m,p] of probes){
   const res=await fetch(PROD+p,{method:m,headers:H,body:(m!=='GET'&&m!=='DELETE')?'{}':undefined});
   const body=await res.text();
   const leak=res.status===200 && body.length>2 && !/error|not found|unauthor|forbidden/i.test(body);
   if(res.status===200 && leak) leaks++;
   console.log(`[${m} ${p.split('/demo')[1]}] ${res.status}${leak?' *** LEAK':''}`);
 }
 console.log(leaks===0?'IDOR sweep clean ✓':`LEAKS: ${leaks}`);
})()
