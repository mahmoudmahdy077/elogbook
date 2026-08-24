// Cycle 49 TEST: push tokens (20260812160000) — register token, read own, delete.
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

let tname=null, sample=null;
for (const t of ['push_tokens','expo_push_tokens','device_tokens']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,{headers:Hr});
  if (r.status===200){ tname=t; sample=await r.json(); break; }
}
console.log('table:', tname, '| cols:', Object.keys(sample?.[0]||{}).join(',')||'empty');
if (!tname) { console.log('no push tokens table'); process.exit(0); }
const cols = Object.keys(sample[0]||{});
const uid = R.user.id;
const tok = `ExponentPushToken[cycle49-${Date.now()}]`;

// table may be empty so sample cols unknown — always send full NOT-NULL shape
const payload = {token: tok, user_id: uid, tenant_id: TENANT, platform: 'ios', active: true};
for (const c of ['user_id','tenant_id','platform']) {
  if (!cols.length || cols.includes(c)) { /* keep */ }
}
payload.user_id = uid; payload.tenant_id = TENANT;

let ins = await fetch(`${URL}/rest/v1/${tname}?select=*`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify(payload)});
let body = await ins.text();
ok('token-registered', ins.ok, `${ins.status} ${body.slice(0,90)}`);

if (ins.ok) {
  const mine = await fetch(`${URL}/rest/v1/${tname}?token=eq.${tok}&select=*`,{headers:Hr}).then(x=>x.json());
  ok('token-readable-by-owner', mine.length===1);
  // upsert duplicate — unique constraint on token?
  let dup = await fetch(`${URL}/rest/v1/${tname}?select=*`,{method:'POST',headers:Hr,body:JSON.stringify(payload)});
  ok('dup-token-handled', dup.status===409 || dup.ok, `status=${dup.status}`);
  // cleanup
  await fetch(`${URL}/rest/v1/${tname}?token=eq.${tok}`,{method:'DELETE',headers:Hr});
  const gone = await fetch(`${URL}/rest/v1/${tname}?token=eq.${tok}&select=*`,{headers:Hr}).then(x=>x.json());
  ok('cleanup', gone.length===0);
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle49 push-tokens: ${results.length-fails}/${results.length} checks passed`);
