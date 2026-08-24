// Cycle 12 TEST: billing — list-invoices edge function latency + fast-fail contract.
// Web proxy has its own timeout handling; measure raw edge function latency.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

const S = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'supervisor@demo.com', password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY, Authorization:'Bearer '+S.access_token, 'Content-Type':'application/json'};
ok('login', !!S.access_token);

async function probe(fnPath, label) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(), 25000);
  try {
    const res = await fetch(`${URL}/functions/v1/${fnPath}`, {headers:H, signal:ctl.signal});
    const ms = Date.now()-t0;
    const body = (await res.text()).slice(0,150);
    ok(label, ms < 5000, `${res.status} in ${(ms/1000).toFixed(1)}s ${body}`);
    return {status:res.status, ms};
  } catch(e) {
    ok(label, false, `TIMEOUT after ${((Date.now()-t0)/1000).toFixed(1)}s`);
    return {status:0, ms:Date.now()-t0};
  } finally { clearTimeout(timer); }
}

await probe('list-invoices?customer_id=', 'list-invoices-empty-customer-fast');
await probe('list-invoices', 'list-invoices-no-param-fast');

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle12 billing: ${results.length-fails}/${results.length} checks passed`);
