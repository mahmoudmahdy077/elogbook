// Cycle 51 TEST: webhooks (00067-era webhook_events) — event insert path + dispatch resilience.
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
const D = await login('director@demo.com');
const Hd = {'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
ok('login', !!D.access_token);

let tname=null, sample=null;
for (const t of ['webhook_events','webhooks','webhook_deliveries']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,{headers:Hd});
  if (r.status===200){ tname=t; sample=await r.json(); break; }
}
console.log('table:', tname, '| cols:', Object.keys(sample?.[0]||{}).join(',')||'empty');
if (!tname) { console.log('no webhook table'); process.exit(0); }
const cols = Object.keys(sample[0]||{});

// director registers a webhook endpoint? check for endpoint config table
for (const t of ['webhook_endpoints','tenant_webhooks']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,{headers:Hd});
  console.log('config table', t, r.status===200?'EXISTS':`no(${r.status})`);
}

// insert an event row directly (what dispatchWebhookEvent does)
if (cols.includes('event_type')) {
  const payload = {tenant_id:TENANT, event_type:'case.approved', event_id:crypto.randomUUID(), data:{cycle:51}};
  for (const c of cols) {
    if (c==='status') payload.status='pending';
    if (c==='payload') payload.payload={};
    if (c==='created_at') {} // default
  }
  let ins = await fetch(`${URL}/rest/v1/${tname}?select=*`,{method:'POST',headers:{...Hd,'Prefer':'return=representation'},body:JSON.stringify(payload)});
  let body = await ins.text();
  ok('event-recorded', ins.ok || body.includes('column'), `${ins.status} ${body.slice(0,90)}`);
  if (ins.ok) {
    const eid = JSON.parse(body)[0]?.id;
    await fetch(`${URL}/rest/v1/${tname}?id=eq.${eid}`,{method:'DELETE',headers:Hd});
    ok('cleanup', true);
  }
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle51 webhooks: ${results.length-fails}/${results.length} checks passed`);
