import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL,KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,TENANT='9cd50d60-febe-4adf-be0f-a36bf82762f6',SRK=process.env.SUPABASE_SERVICE_ROLE_KEY;
(async()=>{
 const R=await fetch(SB+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
 const H={apikey:KEY,Authorization:'Bearer '+R.access_token};
 const slugRes=await fetch(`${SB}/rest/v1/tenants?slug=eq.global-community&select=slug`,{headers:H}).then(r=>r.json());
 void slugRes;
 // tenant slug for demo = 'demo'? derive from tenants table via authenticated read
 const trow=await fetch(`${SB}/rest/v1/tenants?id=eq.${TENANT}&select=slug`,{headers:H}).then(r=>r.json());
 const slug=trow[0]?.slug ?? 'demo';
 const path=`${slug}/probe-${Date.now()}.txt`;
 const up=await fetch(`${SB}/storage/v1/object/case-attachments/${path}`,{method:'POST',headers:{...H,'Content-Type':'text/plain','x-upsert':'true'},body:'wave4 storage policy verification'});
 console.log('[upload]',up.status,up.ok?'OK ✓':(await up.text()).slice(0,120));
 if(up.ok){
  const sign=await fetch(`${SB}/storage/v1/object/sign/case-attachments/${path}`,{method:'POST',headers:{...H,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60})}).then(r=>r.json());
  console.log('[signed url]',sign.signedURL?'OK ✓':'FAIL');
  const dl=sign.signedURL?await fetch(SB+`/storage/v1`+sign.signedURL).then(r=>r.text()):'';
  console.log('[content]',dl);
  const del=await fetch(`${SB}/storage/v1/object/case-attachments/${path}`,{method:'DELETE',headers:H});
  console.log('[delete]',del.status);
 }
})()
