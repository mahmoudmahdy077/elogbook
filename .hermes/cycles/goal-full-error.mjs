// Get FULL error — is it still audit_logs or something else now?
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const D = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'director@demo.com',password:'password123!'})}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
const p = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${D.user.id}`,{headers:H}).then(r=>r.json());
const R = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
const rp = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${R.user.id}`,{headers:{'apikey':KEY,'Authorization':'Bearer '+R.access_token}}).then(r=>r.json());
const res = await fetch(`${URL}/rest/v1/program_goals?select=id`,{method:'POST',headers:{...H,'Prefer':'return=representation'},body:JSON.stringify({
  tenant_id:TENANT,director_id:p[0].id,resident_id:rp[0].id,title:'full-error-probe',target_count:2,deadline:'2026-12-31'
})});
console.log(res.status, await res.text());

// cleanup
await fetch(`${URL}/rest/v1/program_goals?id=eq.7d83ff6d-3a38-4398-b72f-51d96adf5407`,{method:'DELETE',headers:H});
console.log('probe goal cleaned');
