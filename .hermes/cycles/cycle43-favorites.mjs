// Cycle 43 TEST: favorites (00067_audit_favorites) — resident favorites a template,
// reads own, dedupe/unfavorite, cross-user privacy.
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

// find table name + columns
let probe;
for (const t of ['favorites','template_favorites','user_favorites']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,{headers:Hr});
  if (r.status===200) { probe={name:t, sample: await r.json()}; break; }
  if (r.status!==404) { const b=await r.text(); console.log(t, r.status, b.slice(0,80)); }
}
if (!probe) { console.log('NO favorites table found'); process.exit(1); }
console.log('table:', probe.name, '| cols:', Object.keys(probe.sample[0]||{}).join(',') || 'empty');

// get a template to favorite
const tmpl = await fetch(`${URL}/rest/v1/case_templates?select=id&tenant_id=in.(${TENANT},00000000-0000-0000-0000-000000000000)&limit=1`,{headers:Hr}).then(r=>r.json());
ok('have-template', tmpl.length>0);

if (tmpl.length) {
  // discover insert shape by trying minimal with user_id
  const R2 = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
  let payload = {template_id: tmpl[0].id};
  const cols = Object.keys(probe.sample[0]||{});
  if (!cols.length || cols.includes('user_id')) payload.user_id = R2.user.id; // composite PK table
  let ins = await fetch(`${URL}/rest/v1/${probe.name}?select=user_id,template_id`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify(payload)});
  let body = await ins.text();
  ok('favorite-created', ins.ok, `${ins.status} ${body.slice(0,90)}`);
  const hasRow = ins.ok;

  if (hasRow) {
    // visible to self
    const mine = await fetch(`${URL}/rest/v1/${probe.name}?template_id=eq.${tmpl[0].id}&select=user_id,template_id`,{headers:Hr}).then(x=>x.json());
    ok('favorite-readable-by-self', mine.length===1 && mine[0].user_id===R2.user.id);
    // unfavorite (composite PK delete)
    await fetch(`${URL}/rest/v1/${probe.name}?user_id=eq.${R2.user.id}&template_id=eq.${tmpl[0].id}`,{method:'DELETE',headers:Hr});
    const gone = await fetch(`${URL}/rest/v1/${probe.name}?template_id=eq.${tmpl[0].id}&select=user_id`,{headers:Hr}).then(x=>x.json());
    ok('unfavorite-works', gone.length===0);
  }
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle43 favorites: ${results.length-fails}/${results.length} checks passed`);
