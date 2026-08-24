// Cycle 3 (pivot): free quota slots by tombstoning rows the SUPERVISOR policy permits.
// Supervisor update policy: USING/WITH CHECK status='pending'. No pending rows exist, so
// instead: RESIDENT can update own draft/rejected rows. Check statuses present and act.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';

async function login(email) {
  return fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method:'POST', headers:{'Content-Type':'application/json','apikey':KEY},
    body: JSON.stringify({email, password:'password123!'}), signal: AbortSignal.timeout(30000)
  }).then(r=>r.json());
}
const r_ = await login('resident@demo.com');
const H = {'apikey':KEY,'Authorization':`Bearer ${r_.access_token}`,'Content-Type':'application/json'};
const rows = await fetch(`${URL}/rest/v1/case_entries?deleted_at=is.null&select=id,status&tenant_id=eq.${TENANT}`, {headers:H}).then(r=>r.json());
const byStatus = {};
for (const r of rows) byStatus[r.status]=(byStatus[r.status]??0)+1;
console.log('status histogram:', JSON.stringify(byStatus));
