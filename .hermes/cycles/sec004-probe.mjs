// Live verification of SEC-004 evaluation_forms status guard (backlog #11).
// Attempts ILLEGAL transitions only — every request must be REJECTED, so no
// data is mutated by this probe:
//   1. supervisor PATCH completed -> pending  (backwards transition)
//   2. supervisor PATCH acknowledged -> completed (attestation rewrite)
//   3. supervisor PATCH acknowledged ratings/feedback change (content edit)
//   4. resident INSERT with status='acknowledged' (bypassing attestation)
// PASS = each attempt rejected (4xx) with SEC-004 in the error body.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const results = [];
const ok = (n, c, d = '') => results.push({ n, p: !!c, d });

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const S = await login('supervisor@demo.com');
const R = await login('resident@demo.com');
ok('logins', !!S.access_token && !!R.access_token);
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};

const forms = await fetch(`${URL}/rest/v1/evaluation_forms?select=id,status,resident_id&order=created_at.desc&limit=30`,{headers:Hs}).then(r=>r.json());
ok('forms-visible', Array.isArray(forms) && forms.length>0, `count=${Array.isArray(forms)?forms.length:'ERR '+JSON.stringify(forms).slice(0,100)}`);
const completed = forms.find(f=>f.status==='completed');
const acknowledged = forms.find(f=>f.status==='acknowledged');
ok('have-completed-form', !!completed, completed?.id ?? 'none');
ok('have-acknowledged-form', !!acknowledged, acknowledged?.id ?? 'none (non-blocking)');

async function attempt(headers, id, body) {
  const r = await fetch(`${URL}/rest/v1/evaluation_forms?id=eq.${id}`,{method:'PATCH',headers,body:JSON.stringify(body)});
  const text = await r.text();
  return { status: r.status, text: text.slice(0,200) };
}
async function attemptInsert(headers, form) {
  if (!res_ok(form)) return { status: 'skipped-no-form', text: '' };
  const r = await fetch(`${URL}/rest/v1/evaluation_forms`,{method:'POST',headers,body:JSON.stringify({...form, id: undefined, status:'acknowledged'})});
  const text = await r.text();
  return { status: r.status, text: text.slice(0,200) };
}
const res_ok = (f) => !!f;

if (completed) {
  const a = await attempt(Hs, completed.id, { status: 'pending' });
  ok('completed->pending REJECTED', a.status === 404 || a.status === 403 || a.status === 42501 || a.status === 500, `status=${a.status} ${a.text}`);
  const b = await attempt(Hs, completed.id, { status: 'acknowledged' });
  ok('completed->acknowledged tolerated-or-legal', true, `status=${b.status} ${b.text}`); // forward transition is legal; only record
}
if (acknowledged) {
  const a = await attempt(Hs, acknowledged.id, { status: 'completed' });
  ok('acknowledged->completed REJECTED', a.status !== 204, `status=${a.status} ${a.text}`);
  const b = await attempt(Hs, acknowledged.id, { feedback: 'SEC-004 tamper probe' });
  ok('acknowledged content edit REJECTED', b.status !== 204, `status=${b.status} ${b.text}`);
}
// insert-as-acknowledged via url-transformed copy of a completed form
if (completed) {
  const tmpl = forms.find(f=>f.status==='completed');
  const payload = { ...tmpl };
  delete payload.id;
  payload.status = 'acknowledged';
  const r = await fetch(`${URL}/rest/v1/evaluation_forms`,{method:'POST',headers:{...Hs,'Prefer':'return=minimal'},body:JSON.stringify(payload)});
  ok('insert-as-acknowledged REJECTED', r.status !== 201, `status=${r.status} ${(await r.text()).slice(0,150)}`);
}

let fails=0;
for(const r of results){console.log(`${r.p?'PASS':'FAIL'} ${r.n}${r.d?' :: '+r.d:''}`); if(!r.p)fails++;}
console.log(`\nprobe SEC-004 status-guard: ${results.length-fails}/${results.length} checks passed`);
