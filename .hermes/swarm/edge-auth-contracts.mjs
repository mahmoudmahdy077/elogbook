import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const login=async(e)=>fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());
(async()=>{
 const R=await login('resident@demo.com');
 const H={apikey:KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
 // pick an existing approved deidentified case
 const prof=(await fetch(`${SB}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id`,{headers:H}).then(r=>r.json()))[0];
 const cases=await fetch(`${SB}/rest/v1/case_entries?select=id&resident_id=eq.${prof.id}&status=eq.approved&deleted_at=is.null&limit=1`,{headers:H}).then(r=>r.json());
 const cid=cases[0]?.id;
 console.log('[case]',cid?.slice(0,8));

 // generate-pdf with real payload
 let gp={status:0,body:''};
 if(cid){
  const t=Date.now();
  const res=await fetch(SB+'/functions/v1/generate-pdf',{method:'POST',headers:H,body:JSON.stringify({case_id:cid})});
  gp.status=res.status; gp.body=(await res.text()).slice(0,60);
  console.log('[generate-pdf]',res.status,(gp.body.startsWith('%PDF')?'%PDF magic ✓':gp.body.slice(0,80)),'in',Date.now()-t+'ms');
 }
 // ai-quality on the case
 if(cid){
  const t=Date.now();
  const res=await fetch(SB+'/functions/v1/ai-quality',{method:'POST',headers:H,body:JSON.stringify({case_id:cid})});
  const body=await res.text();
  console.log('[ai-quality]',res.status,body.slice(0,110),'in',Date.now()-t+'ms');
 }
 // create-checkout authenticated shape
 const co=await fetch(SB+'/functions/v1/create-checkout',{method:'POST',headers:H,body:JSON.stringify({price_id:'price_invalid_probe'})});
 console.log('[create-checkout]',co.status,(await co.text()).slice(0,100));
})()
