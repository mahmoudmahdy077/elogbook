import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const R = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
const prof = await fetch(`${URL}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id,tenant_id`,{headers:H}).then(r=>r.json());
const pid = prof[0].id;
console.log('profile:', pid.slice(0,8), 'tenant ok:', prof[0].tenant_id === TENANT);

// F1 repro: PATCH own tenant_id -> real foreign tenant. Must now FAIL.
const r1 = await fetch(`${URL}/rest/v1/profiles?id=eq.${pid}`,{method:'PATCH',headers:H,body:JSON.stringify({tenant_id:'11111111-1111-1111-1111-111111111111'})});
console.log('F1 cross-tenant self-move:', r1.status, r1.status===403||r1.status===400 ? 'BLOCKED ✓' : 'STILL VULNERABLE ✗');

// Regression: legitimate own-profile update must still work
const r2 = await fetch(`${URL}/rest/v1/profiles?id=eq.${pid}`,{method:'PATCH',headers:H,body:JSON.stringify({full_name:'Dr. Alex Resident'})});
console.log('legit own-name update:', r2.status, r2.status===204?'OK ✓':'BROKEN ✗');
