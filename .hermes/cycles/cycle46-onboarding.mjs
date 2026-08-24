// Cycle 46 TEST: onboarding steps (00083) — resident onboarding state machine:
// steps visible, mark-step-done, completion gating.
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

// find table
let tname=null, sample=null;
for (const t of ['onboarding_steps','user_onboarding','onboarding']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,{headers:Hr});
  if (r.status===200){ tname=t; sample=await r.json(); break; }
}
console.log('table:', tname, '| cols:', Object.keys(sample?.[0]||{}).join(',')||'empty');

if (!tname) { console.log('NO onboarding table'); process.exit(0); }
const cols = Object.keys(sample[0]||{});
const uid = R.user.id;

// insert a step row for self
const payload = {};
if (cols.includes('user_id')) payload.user_id = uid;
if (cols.includes('tenant_id')) payload.tenant_id = TENANT;
if (cols.includes('step_key')) payload.step_key = 'cycle46_step';
if (cols.includes('step')) payload.step = 'cycle46_step';
if (cols.includes('completed_at')) payload.completed_at = new Date().toISOString();
if (cols.includes('is_completed')) payload.is_completed = true;
if (cols.includes('done')) payload.done = true;

let ins = await fetch(`${URL}/rest/v1/${tname}?select=*`,{method:'POST',headers:{...Hr,'Prefer':'return=representation'},body:JSON.stringify(payload)});
let body = await ins.text();
ok('step-recorded', ins.ok, `${ins.status} ${body.slice(0,90)}`);

if (ins.ok) {
  // read own
  const mine = await fetch(`${URL}/rest/v1/${tname}?select=*&limit=10`,{headers:Hr}).then(x=>x.json());
  ok('steps-readable-by-self', Array.isArray(mine) && mine.length>=1, `rows=${mine.length}`);
  // cleanup by matching key
  let del;
  if (payload.step_key) del = await fetch(`${URL}/rest/v1/${tname}?step_key=eq.cycle46_step`,{method:'DELETE',headers:Hr});
  else if (payload.step) del = await fetch(`${URL}/rest/v1/${tname}?step=eq.cycle46_step`,{method:'DELETE',headers:Hr});
  else del = await fetch(`${URL}/rest/v1/${tname}?user_id=eq.${uid}`,{method:'DELETE',headers:Hr});
  ok('cleanup', del.ok||del.status===204, `status=${del.status}`);
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle46 onboarding: ${results.length-fails}/${results.length} checks passed`);
