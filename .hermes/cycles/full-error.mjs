// Get the FULL error message — which function is missing now?
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const R = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'resident@demo.com', password:'password123!'})
}).then(r=>r.json());
const H = {'apikey':KEY, Authorization:'Bearer '+R.access_token, 'Content-Type':'application/json'};
const res = await fetch(URL+'/rest/v1/case_entries?id=eq.1933dc56-fe7c-48c1-b5a5-d8bd0ed085bf', {
  method:'PATCH', headers:H, body:JSON.stringify({deleted_at:new Date().toISOString()})
});
console.log(res.status, await res.text());
