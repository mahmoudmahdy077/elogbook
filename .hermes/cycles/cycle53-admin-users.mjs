// Cycle 53 TEST: admin user management (20260818140000) — director lists/updates roles,
// cannot escalate self to admin, MFA-gated escalation (from RBAC suite contract).
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

// director reads tenant profiles
const profs = await fetch(`${URL}/rest/v1/profiles?tenant_id=eq.${TENANT}&select=id,role,full_name&limit=20`,{headers:Hd}).then(r=>r.json());
ok('director-lists-profiles', Array.isArray(profs) && profs.length>=3, `n=${profs.length}`);

// resident cannot read others' roles
const rview = await fetch(`${URL}/rest/v1/profiles?tenant_id=eq.${TENANT}&select=id,role&limit=20`,{headers:Hr}).then(r=>r.json());
ok('resident-role-view-scoped', Array.isArray(rview) && !rview.some(p=>p.role && p.role!=='resident'), `n=${rview.length} roles=${[...new Set(rview.map(p=>p.role))].join(',')}`);

// resident cannot change own role
const dprof = profs.find(p=>p.role==='director');
const rprof = await fetch(`${URL}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id,role`,{headers:Hr}).then(x=>x.json());
const esc = await fetch(`${URL}/rest/v1/profiles?id=eq.${rprof[0]?.id}`,{method:'PATCH',headers:Hr,body:JSON.stringify({role:'admin'})});
ok('resident-cannot-escalate-self', esc.status===400||esc.status===401||esc.status===403||esc.status===42501, `status=${esc.status}`);
const stillR = await fetch(`${URL}/rest/v1/profiles?id=eq.${rprof[0]?.id}&select=role`,{headers:Hd}).then(x=>x.json());
ok('role-unchanged-after-attack', stillR[0]?.role==='resident', `role=${stillR[0]?.role}`);

// director cannot set role to admin directly (must be global admin / MFA-gated)
const dEsc = await fetch(`${URL}/rest/v1/profiles?id=eq.${rprof[0]?.id}`,{method:'PATCH',headers:Hd,body:JSON.stringify({role:'admin'})});
const afterD = await fetch(`${URL}/rest/v1/profiles?id=eq.${rprof[0]?.id}&select=role`,{headers:Hd}).then(x=>x.json());
ok('director-cannot-grant-admin', afterD[0]?.role==='resident', `patch=${dEsc.status} role=${afterD[0]?.role}`);

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle53 admin-user-mgmt: ${results.length-fails}/${results.length} checks passed`);
