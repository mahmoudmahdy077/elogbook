// W9: malformed payload fuzz — POST/PUT junk at key routes; any 500 = unhandled bug
import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROD='https://elogbook-web.vercel.app';
(async()=>{
 const R=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
 const H={'Content-Type':'application/json',apikey:KEY,'Authorization':'Bearer '+R.access_token};
 // cookie needed for cookie-auth API routes: emulate by hitting with both bearer AND sb cookie? Can't set cookie header cross-jar easily; PostgREST-level fuzz instead + public API routes via PROD.
 const payloads=[
  ['invalid-json','{not json'],
  ['wrong-type','{"case_ids":"notanarray"}'],
  ['null-body','null'],
  ['deep-object','{"a":{"b":{"c":{"d":[1,2,{"e":true}]}}}}'],
  ['sql-ish',"{' OR 1=1 --']"],
 ];
 let serverErrors=0;
 for(const [tag,body] of payloads){
   // edge fn contract
   let r=await fetch(SB+'/functions/v1/generate-pdf',{method:'POST',headers:H,body});
   if(r.status>=500){serverErrors++;console.log(`[generate-pdf ${tag}] ${r.status} *** 500`)}
   // public csp endpoint
   r=await fetch(PROD+'/api/csp-violation',{method:'POST',headers:H,body});
   if(r.status>=500){serverErrors++;console.log(`[csp-violation ${tag}] ${r.status} *** 500`)}
 }
 console.log(serverErrors===0?'fuzz clean: no 5xx across payloads ✓':`server errors: ${serverErrors}`);
})()
