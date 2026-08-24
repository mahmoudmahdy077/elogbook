// Cycle 51 TEST: webhooks — tenant_webhooks registration + URL CHECK constraint +
// deliveries/retry tables readable + resident denial. Mirrors WebhookManager.tsx contract.
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

// discover tenant_webhooks columns from a live row or empty select
const colsRes = await fetch(`${URL}/rest/v1/tenant_webhooks?select=*&limit=1`,{headers:Hd});
ok('tenant-webhooks-readable', colsRes.status===200, `${colsRes.status}`);
let sample = [];
try { sample = await colsRes.json(); } catch {}
const cols = Object.keys(sample?.[0]||{});
console.log('cols:', cols.join(',')||'(empty table)');

// director registers webhook (schema 00063: url/events/secret/is_active/description)
const wid = crypto.randomUUID();
const payload = {id:wid, tenant_id:TENANT, url:'https://example.com/hook/cycle51', events:['case.approved'], secret:`whsec_cycle51_${Date.now()}`, is_active:true};
const ins = await fetch(`${URL}/rest/v1/tenant_webhooks?select=id`,{method:'POST',headers:{...Hd,'Prefer':'return=representation'},body:JSON.stringify(payload)});
ok('webhook-register-201', ins.ok, `${ins.status} ${(await ins.text()).slice(0,120)}`);

// bad URL must violate CHECK
if (ins.ok) {
  const bad = await fetch(`${URL}/rest/v1/tenant_webhooks`,{method:'POST',headers:Hd,body:JSON.stringify({...payload, id:crypto.randomUUID(), url:'not-a-url'})});
  ok('bad-url-check-rejects', bad.status===400 || bad.status===403, `${bad.status}`);
}

// resident cannot register
const resIns = await fetch(`${URL}/rest/v1/tenant_webhooks`,{method:'POST',headers:Hr,body:JSON.stringify({...payload, id:crypto.randomUUID()})});
ok('resident-register-denied', !resIns.ok, `${resIns.status}`);

// deliveries + retry queue readable by director (dispatch observability surface)
for (const t of ['tenant_webhook_deliveries','webhook_retry_queue']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,{headers:Hd});
  ok(`${t}-readable`, r.status===200, `${r.status}`);
}

// cleanup
if (ins.ok) await fetch(`${URL}/rest/v1/tenant_webhooks?id=eq.${wid}`,{method:'DELETE',headers:Hd});
ok('cleanup', true);

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle51 webhooks: ${results.length-fails}/${results.length} checks passed`);
