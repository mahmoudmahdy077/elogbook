// Cycle 12 TEST: billing — list-invoices edge function hang probe (P2 #3)
// Web proxy has its own timeout handling; measure raw edge function latency.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'supervisor@demo.com', password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY, Authorization:'Bearer '+S.access_token, 'Content-Type':'application/json'};

const t0 = Date.now();
const ctl = new AbortController();
const timer = setTimeout(()=>ctl.abort(), 25000);
try {
  const res = await fetch(`${URL}/functions/v1/list-invoices?customer_id=`, {headers:H, signal:ctl.signal});
  const dt = ((Date.now()-t0)/1000).toFixed(1);
  console.log('status:', res.status, 'in', dt+'s', (await res.text()).slice(0,150));
} catch(e) {
  console.log('TIMEOUT/ERR after', ((Date.now()-t0)/1000).toFixed(1)+'s', '-', e.message);
} finally { clearTimeout(timer); }

// missing customer_id entirely
const t1 = Date.now();
const c2 = new AbortController(); const tm2 = setTimeout(()=>c2.abort(), 25000);
try {
  const res = await fetch(`${URL}/functions/v1/list-invoices`, {headers:H, signal:c2.signal});
  console.log('no-param status:', res.status, 'in', ((Date.now()-t1)/1000).toFixed(1)+'s', (await res.text()).slice(0,150));
} catch(e){ console.log('no-param TIMEOUT after', ((Date.now()-t1)/1000).toFixed(1)+'s'); }
finally { clearTimeout(tm2); }
