// Check live non-deleted case count + who owns them
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
  body: JSON.stringify({email:'resident@demo.com',password:'password123!'}), signal: AbortSignal.timeout(30000)
}).then(r=>r.json());
const H = {'apikey':KEY,'Authorization':`Bearer ${login.access_token}`};
const rows = await fetch(`${URL}/rest/v1/case_entries?deleted_at=is.null&select=id,resident_id,status,patient_hash`, {headers:H}).then(r=>r.json());
console.log('visible non-deleted:', rows.length);
const byRes = {};
for (const r of rows) byRes[r.resident_id] = (byRes[r.resident_id]??0)+1;
console.log('by resident:', JSON.stringify(byRes));
