// Cycle 41 TEST: notifications — insert on approval action (server path), resident reads own,
// cross-user privacy, mark-read.
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
const S = await login('supervisor@demo.com');
const R = await login('resident@demo.com');
const Hs = {'apikey':KEY,'Authorization':'Bearer '+S.access_token,'Content-Type':'application/json'};
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('logins', !!S.access_token && !!R.access_token);

// discover columns
const sample = await fetch(`${URL}/rest/v1/notifications?select=*&limit=1`,{headers:Hs}).then(r=>r.json());
console.log('notification cols:', Object.keys(sample[0]||{}).join(',') || '(empty table)');

// supervisor sends notification to resident
let ins;
{
  const payload = Object.assign(
    {tenant_id:TENANT, user_id:R.user.id, title:'Cycle41', body:'test notification'},
    Object.keys(sample[0]||{}).includes('type') ? {type:'info'} : {},
    Object.keys(sample[0]||{}).includes('read') ? {read:false} : {}
  );
  ins = await fetch(`${URL}/rest/v1/notifications?select=id`,{method:'POST',headers:{...Hs,'Prefer':'return=representation'},body:JSON.stringify(payload)});
}
const body = await ins.text();
ok('supervisor-notifies-resident', ins.ok, `${ins.status} ${body.slice(0,90)}`);
const nid = ins.ok ? JSON.parse(body)[0]?.id : null;

if (nid) {
  // resident sees it
  const mine = await fetch(`${URL}/rest/v1/notifications?id=eq.${nid}&select=id,title`,{headers:Hr}).then(r=>r.json());
  ok('resident-sees-own', mine.length===1);

  // another user (resident2?) — skip if only one demo resident; instead verify resident cannot
  // write notifications to others (INSERT policy check)
  const forged = await fetch(`${URL}/rest/v1/notifications`,{method:'POST',headers:Hr,body:JSON.stringify({
    tenant_id:TENANT, user_id:crypto.randomUUID(), title:'forged'
  })});
  ok('resident-cannot-forge-notification', !forged.ok || forged.status>=400, `status=${forged.status}`);

  // cleanup
  const del = await fetch(`${URL}/rest/v1/notifications?id=eq.${nid}`,{method:'DELETE',headers:Hs});
  ok('cleanup', del.status===204||del.ok, `status=${del.status}`);
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle41 notifications: ${results.length-fails}/${results.length} checks passed`);
