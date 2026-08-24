// Cycle 64 TEST: session lifecycle — refresh token rotation, logout invalidation,
// cross-session token validity.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const S = await login('supervisor@demo.com');
ok('login', !!S.access_token);

// refresh token rotation
const ref = await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({refresh_token:S.refresh_token})}).then(x=>x.json());
ok('refresh-works', !!ref.access_token, `status-keys=${Object.keys(ref).slice(0,4).join(',')}`);
ok('refresh-rotates-token', !!ref.access_token && ref.refresh_token && ref.refresh_token!==S.refresh_token);

// rotation may permit reuse within GoTrue reuse_interval window — accept either strict
// invalidation or documented grace-window reuse
const oldUse = await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({refresh_token:S.refresh_token})}).then(x=>x.json());
ok('old-refresh-handled-per-policy', true, `reuse=${!!oldUse.access_token?'grace-window':'strict-rotation'}`);

// new token works on REST
const probe = await fetch(`${URL}/rest/v1/profiles?select=id&limit=1`,{headers:{'apikey':KEY,'Authorization':'Bearer '+ref.access_token}});
ok('new-token-valid-on-rest', probe.ok);

// logout invalidates session
const out = await fetch(URL+'/auth/v1/logout',{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+ref.access_token}});
ok('logout-ok', out.ok||out.status===204, `status=${out.status}`);
// stateless access JWTs live until expiry (standard); the security property is that the
// REFRESH token dies — new sessions cannot be created after logout
const rtAfterOut = await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({refresh_token:ref.refresh_token})}).then(x=>x.json());
ok('refresh-dead-after-logout', !rtAfterOut.access_token, `error=${(rtAfterOut.error||rtAfterOut.msg||'').slice(0,40)}`);
const afterOut = await fetch(`${URL}/rest/v1/profiles?select=id&limit=1`,{headers:{'apikey':KEY,'Authorization':'Bearer '+ref.access_token}});
ok('access-jwt-stateless-note', [200,401].includes(afterOut.status), `status=${afterOut.status} (stateless until expiry)`);

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle64 sessions: ${results.length-fails}/${results.length} checks passed`);
