// Cycle 32 TEST: health + backup + contact endpoints (ops surface) — availability & auth shape
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

// Supabase health (REST reachable with anon credentials — RLS-scoped)
const t0 = Date.now();
let r = await fetch(`${URL}/rest/v1/profiles?select=id&limit=1`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});
ok('rest-alive', r.status===200||r.status===204, `${r.status} in ${Date.now()-t0}ms`);

// auth health endpoint
r = await fetch(`${URL}/auth/v1/health`,{headers:{apikey:KEY}}).then(x=>x.json()).catch(()=>null);
ok('auth-health', !!r && (r.name==='GoTrue'||r.version), JSON.stringify(r).slice(0,80));

// storage reachable
let sr = await fetch(`${URL}/storage/v1/status`,{headers:{apikey:KEY}}).catch(()=>null);
ok('storage-status', !!sr && sr.status < 500, `http ${sr?.status ?? 'unreachable'}`);

// web app production pages respond (unauthenticated shell)
for (const path of ['/login','/api/health']) {
  try {
    const wr = await fetch(`https://elogbook-two.vercel.app${path}`,{redirect:'manual'});
    ok(`web ${path}`, [200,301,302,307,308].includes(wr.status), `status=${wr.status}`);
  } catch(e) { ok(`web ${path}`, false, e.message.slice(0,60)); }
}

// edge functions inventory sanity: known functions all respond <3s (any code)
for (const fn of ['payment-webhook','create-checkout','create-portal-session','list-invoices','ai-quality']) {
  const t=Date.now();
  try{
    const c=new AbortController();setTimeout(()=>c.abort(),8000);
    const res=await fetch(`${URL}/functions/v1/${fn}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,'Authorization':'Bearer '+KEY},body:'{}',signal:c.signal});
    const ms=Date.now()-t;
    ok(`edge ${fn}`, res.status>=400 && ms<3000, `${res.status} in ${ms}ms`);
  }catch(e){ ok(`edge ${fn}`, false, `TIMEOUT >8s`); }
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle32 ops-surface: ${results.length-fails}/${results.length} checks passed`);
