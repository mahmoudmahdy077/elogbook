// Supervisor approve on the pending row — verifies approve_case still works after trigger changes
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const S = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method:'POST', headers:{'Content-Type':'application/json', apikey:KEY},
  body: JSON.stringify({email:'supervisor@demo.com', password:'password123!'})
}).then(r=>r.json());
const sub = JSON.parse(Buffer.from(S.access_token.split('.')[1], 'base64url').toString()).sub;
const H = {'apikey':KEY, Authorization:'Bearer '+S.access_token, 'Content-Type':'application/json'};
const res = await fetch(URL+'/rest/v1/rpc/approve_case', {
  method:'POST', headers:H,
  body: JSON.stringify({p_entry_id:'8922e071-7e61-4172-a856-c927f6afc6b7', p_supervisor_id:sub, p_comment:'verify post-hotfix'})
});
console.log(res.status, await res.text());
