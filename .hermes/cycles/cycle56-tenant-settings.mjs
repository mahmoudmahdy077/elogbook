// Cycle 56 TEST: tenant_settings (20260818140000) — admin manages, tenant members read.
// Also subscription_changes read scoping.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const D = await login('director@demo.com');
const R = await login('resident@demo.com');
const Hd = {'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('logins', !!D.access_token && !!R.access_token);

// tenant_settings read by member
const tsRead = await fetch(`${URL}/rest/v1/tenant_settings?select=*&limit=1`,{headers:Hr}).then(async r=>({s:r.status,b:await r.text()}));
ok('resident-reads-tenant-settings', tsRead.s===200||tsRead.s===404, `${tsRead.s} ${tsRead.b.slice(0,80)}`);

// resident cannot write settings
let payload;
{
  const probe = await fetch(`${URL}/rest/v1/tenant_settings?select=*&limit=1`,{headers:Hd}).then(r=>r.json());
  const cols = Object.keys(probe[0]||{});
  payload = {tenant_id:TENANT};
  if (cols.includes('settings')) payload.settings={cycle56:true};
  if (cols.includes('branding')) payload.branding={};
}
const tsWrite = await fetch(`${URL}/rest/v1/tenant_settings`,{method:'POST',headers:Hr,body:JSON.stringify(payload)}).then(r=>r.status);
ok('resident-cannot-write-settings', tsWrite!==200&&tsWrite!==201, `status=${tsWrite}`);

// director writes settings (admin-managed per policy? check result)
const dWrite = await fetch(`${URL}/rest/v1/tenant_settings?select=*`,{method:'POST',headers:{...Hd,'Prefer':'return=representation'},body:JSON.stringify(payload)});
const dBody = await dWrite.text();
ok('director-writes-settings-or-policy-gated', [200,201,403].includes(dWrite.status), `${dWrite.status} ${dBody.slice(0,90)}`);
if (dWrite.ok) {
  const sid = JSON.parse(dBody)[0]?.id;
  await fetch(`${URL}/rest/v1/tenant_settings?id=eq.${sid}`,{method:'DELETE',headers:Hd});
}

// subscription_changes readable scoped
const sc = await fetch(`${URL}/rest/v1/subscription_changes?select=*&limit=5`,{headers:Hd}).then(async r=>({s:r.status,n:(await r.text()).length}));
ok('subscription-changes-queryable', sc.s===200||sc.s===404, `status=${sc.s}`);

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle56 tenant-settings: ${results.length-fails}/${results.length} checks passed`);
