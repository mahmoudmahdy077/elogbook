import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PROD='https://elogbook-web.vercel.app';
(async()=>{
 // one real session for authed calls
 const s=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
 const targets=[
  ()=>fetch(PROD+'/api/health'),
  ()=>fetch(SB+'/rest/v1/case_entries?select=id&resident_id=eq.'+s.user.id+'&deleted_at=is.null&limit=10',{headers:{apikey:KEY,Authorization:'Bearer '+s.access_token}}),
  ()=>fetch(PROD+'/login'),
  ()=>fetch(SB+'/rest/v1/rpc/check_case_quota',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+s.access_token},body:JSON.stringify({p_tenant_id:'9cd50d60-febe-4adf-be0f-a36bf82762f6'})}),
 ];
 const DURATION=45000, CONCURRENCY=20;
 const lat=[]; let fails=0,total=0; const stop=Date.now()+DURATION;
 async function worker(){
   while(Date.now()<stop){
     const fn=targets[Math.floor(Math.random()*targets.length)];
     const t0=Date.now();
     try{ const r=await fn(); total++; if(r.status>=500) fails++; lat.push(Date.now()-t0); }
     catch{ fails++; }
   }
 }
 await Promise.all(Array.from({length:CONCURRENCY},worker));
 lat.sort((a,b)=>a-b);
 const p=q=>lat[Math.floor(lat.length*q)];
 console.log(`requests=${total} errors(5xx/net)=${fails} (${(100*fails/total).toFixed(2)}%)`);
 console.log(`p50=${p(.5)}ms p95=${p(.95)}ms p99=${p(.99)}ms max=${lat[lat.length-1]}ms`);
})()
