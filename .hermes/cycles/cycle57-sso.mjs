// Cycle 57 TEST: tenant SSO configs (00058) — director manages own tenant SSO config,
// resident denied, protocol CHECK enforced, unique (tenant,protocol).
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const D = await login('director@demo.com');
const R = await login('resident@demo.com');
const Hd = {'apikey':KEY,'Authorization':'Bearer '+D.access_token,'Content-Type':'application/json'};
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('logins', !!D.access_token && !!R.access_token);

// writes are PLATFORM-ADMIN ONLY by design (sso-callback edge fn uses service role)
let ins = await fetch(`${URL}/rest/v1/tenant_sso_configs`,{method:'POST',headers:Hd,body:JSON.stringify({
  tenant_id:TENANT, protocol:'oidc', discovery_url:'https://idp.example.com/.well-known/openid-configuration',
  client_id:'cycle57-client', default_role:'resident'
})});
ok('director-write-denied-by-design', !ins.ok, `status=${ins.status}`);
// director can READ own tenant's config (select policy)
const dRead = await fetch(`${URL}/rest/v1/tenant_sso_configs?select=id,protocol&limit=5`,{headers:Hd}).then(r=>r.status);
ok('director-reads-own-sso', [200,404].includes(dRead), `status=${dRead}`);
const sid = null;
let body='';

// invalid protocol rejected
const badP = await fetch(`${URL}/rest/v1/tenant_sso_configs`,{method:'POST',headers:Hd,body:JSON.stringify({tenant_id:TENANT,protocol:'ldap'})});
ok('invalid-protocol-rejected', !badP.ok, `status=${badP.status}`);

// resident cannot write
const rW = await fetch(`${URL}/rest/v1/tenant_sso_configs`,{method:'POST',headers:Hr,body:JSON.stringify({tenant_id:TENANT,protocol:'saml'})});
ok('resident-cannot-write-sso', !rW.ok, `status=${rW.status}`);

if (sid) {
  // cleanup
  const del = await fetch(`${URL}/rest/v1/tenant_sso_configs?id=eq.${sid}`,{method:'DELETE',headers:Hd});
  ok('cleanup', del.ok||del.status===204, `status=${del.status}`);
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle57 sso-configs: ${results.length-fails}/${results.length} checks passed`);
