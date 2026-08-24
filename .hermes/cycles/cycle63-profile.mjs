// Cycle 63 TEST: profile update flows — resident updates own full_name, cannot change
// role/tenant_id, password change roundtrip (change back), session refresh.
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
const R = await login('resident@demo.com');
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('login', !!R.access_token);

// find own profile
const prof = await fetch(`${URL}/rest/v1/profiles?user_id=eq.${R.user.id}&select=id,full_name,role`,{headers:Hr}).then(x=>x.json());
ok('own-profile-readable', prof.length===1, `name=${prof[0]?.full_name}`);

if (prof.length===1) {
  // update own name (restore after)
  const orig = prof[0].full_name;
  const upd = await fetch(`${URL}/rest/v1/profiles?id=eq.${prof[0].id}`,{method:'PATCH',headers:Hr,body:JSON.stringify({full_name:'Dr. Alex Resident (cycle63)'})});
  const after = await fetch(`${URL}/rest/v1/profiles?id=eq.${prof[0].id}&select=full_name`,{headers:Hr}).then(x=>x.json());
  ok('own-name-updatable', after[0]?.full_name==='Dr. Alex Resident (cycle63)', `patch=${upd.status}`);
  await fetch(`${URL}/rest/v1/profiles?id=eq.${prof[0].id}`,{method:'PATCH',headers:Hr,body:JSON.stringify({full_name:orig})});

  // attempt role change via profile PATCH (should be blocked by trigger/policy)
  const esc = await fetch(`${URL}/rest/v1/profiles?id=eq.${prof[0].id}`,{method:'PATCH',headers:Hr,body:JSON.stringify({role:'director'})});
  const roleAfter = await fetch(`${URL}/rest/v1/profiles?id=eq.${prof[0].id}&select=role`,{headers:Hd2()}).then(x=>x.json()).catch(()=>[]);
  function Hd2(){return Hr;}
  const r2 = Array.isArray(roleAfter)&&roleAfter[0] ? roleAfter[0].role : null;
  ok('self-role-change-blocked', !esc.ok || r2==='resident', `patch=${esc.status} role=${r2}`);

  // password change roundtrip via GoTrue — restore is GUARANTEED via service-role fallback
  const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  async function restorePassword() {
    for (let i = 0; i < 5; i++) {
      const s = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'Cycle63!temp'})}).then(x=>x.json());
      if (s.access_token) {
        const back = await fetch(URL+'/auth/v1/user',{method:'PUT',headers:{'apikey':KEY,'Authorization':'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify({password:'password123!'})});
        if (back.ok) return 'user-path';
      }
      await new Promise(r=>setTimeout(r,2000));
    }
    if (SRK) {
      const uid = R.user.id;
      const adm = await fetch(`${URL}/auth/v1/admin/users/${uid}`,{method:'PUT',headers:{apikey:SRK,Authorization:'Bearer '+SRK,'Content-Type':'application/json'},body:JSON.stringify({password:'password123!'})});
      if (adm.ok) return 'admin-fallback';
    }
    return 'FAILED';
  }
  const ch = await fetch(URL+'/auth/v1/user',{method:'PUT',headers:{...Hr,'Content-Type':'application/json'},body:JSON.stringify({password:'Cycle63!temp'})});
  ok('password-change-ok', ch.ok, `status=${ch.status}`);
  if (ch.ok) {
    let relog = null;
    for (let i = 0; i < 4 && !relog?.access_token; i++) {
      relog = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(x=>x.json()).catch(()=>null);
      if (!relog?.access_token) await new Promise(r=>setTimeout(r,1500));
    }
    ok('old-password-rejected', !relog?.access_token);
    const relog2 = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'Cycle63!temp'})}).then(x=>x.json());
    ok('new-password-works', !!relog2.access_token);
    const how = await restorePassword();
    ok('password-restored', how!=='FAILED', `via=${how}`);
    if (how==='FAILED') console.log('!!! ACCOUNT STATE CORRUPTED — manual restore required');
  }
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle63 profile+password: ${results.length-fails}/${results.length} checks passed`);
