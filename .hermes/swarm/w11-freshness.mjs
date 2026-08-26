import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
(async()=>{
 const D=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'director@demo.com',password:'password123!'})}).then(r=>r.json());
 const H={'Content-Type':'application/json',apikey:KEY,'Authorization':'Bearer '+D.access_token};
 for(const fn of ['generate-pdf','ai-insights','ai-quality','create-checkout','create-portal-session','webads-export']){
   const r=await fetch(SB+'/functions/v1/'+fn,{method:'POST',headers:H,body:'null'});
   const b=await r.text();
   console.log(fn+':',r.status,r.status===400?'GUARD LIVE ✓':(b.includes('Invalid JSON')?'guard-live ✓':'STALE? '+b.slice(0,80)));
 }
})()
