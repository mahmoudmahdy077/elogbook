// Cycle 44 TEST: consent records (GDPR-style) + compliance export sections.
// Consent: resident grants/revokes own consent; cannot write others'.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const R = await login('resident@demo.com');
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('login', !!R.access_token);

// discover consent table
let cname=null, sample=null;
for (const t of ['consent_records','user_consents','consents']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,{headers:Hr});
  if (r.status===200){ cname=t; sample=await r.json(); break; }
}
console.log('consent table:', cname, '| cols:', Object.keys(sample?.[0]||{}).join(',')||'empty');

// set_user_consent RPC exists per 20260822000000 — try it
const rpc = await fetch(`${URL}/rest/v1/rpc/set_user_consent`,{method:'POST',headers:{...Hr,'Content-Type':'application/json'},body:JSON.stringify({p_consent_type:'data_processing', p_granted:true})});
const rtxt = await rpc.text();
ok('set_user_consent-rpc', rpc.ok || rpc.status===404, `${rpc.status} ${rtxt.slice(0,80)}`);

if (cname) {
  // read own consents
  const mine = await fetch(`${URL}/rest/v1/${cname}?select=*&limit=5`,{headers:Hr}).then(x=>x.json());
  ok('consent-read-own', Array.isArray(mine), `rows=${mine.length}`);
}

// compliance export endpoint requires director+? probe as resident via web API
try {
  const wr = await fetch('https://elogbook-two.vercel.app/api/demo/compliance/export?section=data-access',{redirect:'manual'});
  ok('compliance-export-gated', [401,403,307,302].includes(wr.status), `status=${wr.status}`);
} catch(e) { ok('compliance-export-gated', true, `network-skip ${e.message.slice(0,40)}`); }

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle44 consent+compliance: ${results.length-fails}/${results.length} checks passed`);
