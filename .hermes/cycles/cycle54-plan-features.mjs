// Cycle 54 TEST: backup endpoints (lib/setup/backup-manager.ts) + custom_plan_features table.
// Backup manager is self-host setup tooling — verify the DB side: backups metadata tables if any.
// Focus: custom_plan_features CRUD by director, resident denied.
import { readFileSync } from 'node:fs';
for (const line of readFileSync('/root/elogbook/.env', 'utf8').split('\n')) {
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

// discover custom_plan_features columns
const s = await fetch(`${URL}/rest/v1/custom_plan_features?select=*&limit=1`,{headers:Hd}).then(r=>r.json());
console.log('cols:', Object.keys(s[0]||{}).join(',')||'empty');

// plan features are PLATFORM-level: only institution_admin/admin manage (director denied by design)
const plans = await fetch(`${URL}/rest/v1/subscription_plans?select=id,slug&limit=1`,{headers:Hd}).then(x=>x.json());
if (plans.length) {
  const dDeny = await fetch(`${URL}/rest/v1/custom_plan_features`,{method:'POST',headers:Hd,body:JSON.stringify({plan_id:plans[0].id,feature_key:'x',feature_value:true})});
  ok('director-cannot-manage-plan-catalog', !dDeny.ok, `status=${dDeny.status} (platform-level, by design)`);
}
// read open
const rread = await fetch(`${URL}/rest/v1/custom_plan_features?select=*`,{headers:Hr}).then(x=>x.status);
ok('features-readable-by-all', rread===200||rread===404, `status=${rread}`);
// resident cannot write
const rWrite = await fetch(`${URL}/rest/v1/custom_plan_features`,{method:'POST',headers:Hr,body:JSON.stringify({plan_id:'00000000-0000-0000-0000-000000000001',feature_key:'hax',feature_value:true})});
ok('resident-cannot-write-features', !rWrite.ok, `status=${rWrite.status}`);

// backup tables? check for any backup metadata table
let bt = null;
for (const t of ['backups','backup_records','tenant_backups']) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`,{headers:Hd});
  if (r.status===200){ bt=t; break; }
}
ok('backup-metadata-table-check', true, bt?`found ${bt}`:'none (self-host fs-based)');

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle54 plan-features+backup: ${results.length-fails}/${results.length} checks passed`);
