import { readFileSync } from 'node:fs';
for (const l of readFileSync('G:/elogbook/.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)process.env[m[1]]=m[2]}
const SB=process.env.NEXT_PUBLIC_SUPABASE_URL;
const PROD='https://elogbook-web.vercel.app';
(async()=>{
 // 1. Security headers on prod page response
 const r=await fetch(PROD+'/login',{redirect:'manual'});
 const h=Object.fromEntries([...r.headers].map(([k,v])=>[k.toLowerCase(),v]));
 const checks={
  'content-security-policy': !!h['content-security-policy'],
  'strict-transport-security': /max-age=\d{6,}/.test(h['strict-transport-security']??''),
  'x-content-type-options': h['x-content-type-options']==='nosniff',
  'referrer-policy': (h['referrer-policy']??'').includes('strict-origin'),
  'permissions-policy': !!(h['permissions-policy']??'').length,
 };
 console.log('[security headers]');
 for(const [k,v] of Object.entries(checks)) console.log(` ${v?'✓':'✗'} ${k}`);
 // X-Frame-Options from vercel.json headers
 const xf=h['x-frame-options']; console.log(` ${xf==='DENY'?'✓':'✗'} x-frame-options=DENY (${xf})`);

 // 2. CSP violation endpoint accepts reports
 const cv=await fetch(PROD+'/api/csp-violation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({'csp-report':{'document-uri':PROD+'/login','violated-directive':'style-src','blocked-uri':'https://evil.example/x.css'}})});
 console.log('[csp-violation endpoint]',cv.status,cv.status<500?'accepts ✓':'FAIL');

 // 3. Rate limit: hammer an authed API rapidly and expect eventual 429 (rate limiter)
 //    Use unauthenticated /api/health? that's public+limited... use login endpoint lightly instead to avoid lockout.
 //    Safer probe: hit /api/contact-style public POST? Use health spam and look for 429.
 let got429=false;
 for(let i=0;i<60;i++){
   const res=await fetch(SB.replace('.supabase.co','.functions.supabase.co')==='' ? PROD+'/api/health' : PROD+'/api/health');
   if(res.status===429){got429=true;break}
 }
 console.log('[rate-limit health spam]',got429?'429 observed ✓ (limiter active)':'no 429 in 60 req (limit higher or exempt)');
})()
