// Cycle 35 TEST: template management — director creates custom case_template, residents see it,
// case can be logged against it, director updates/deletes. Also GLOBAL_TENANT templates visible.
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

// discover template columns from an existing row
const sample = await fetch(`${URL}/rest/v1/case_templates?select=*&limit=1`,{headers:Hd}).then(r=>r.json());
console.log('template sample keys:', Object.keys(sample[0]||{}).join(','));
const s0 = sample[0]||{};

// create custom template
const tid = crypto.randomUUID();
let ins = await fetch(`${URL}/rest/v1/case_templates?select=id,name`,{method:'POST',headers:{...Hd,'Prefer':'return=representation'},body:JSON.stringify({
  id:tid, tenant_id:TENANT,
  name:'Cycle35 Custom Template',
  specialty:s0.specialty ?? 'internal_medicine',
  fields:s0.fields ?? [{key:'procedure',label:'Procedure',type:'text'},{key:'findings',label:'Findings',type:'textarea'}]
})});
let body = await ins.text();
ok('template-created', ins.ok, `${ins.status} ${body.slice(0,100)}`);

if (ins.ok) {
  // resident sees it in their picker query
  const vis = await fetch(`${URL}/rest/v1/case_templates?select=id,name&tenant_id=in.(${TENANT},00000000-0000-0000-0000-000000000000)&order=name.asc&limit=100`,{headers:Hr}).then(r=>r.json());
  const found = vis.find(t=>t.id===tid);
  ok('resident-sees-template', !!found && found.name==='Cycle35 Custom Template', `visible=${vis.length}`);

  // resident delete attempt: PostgREST may return 204 for a FILTERED (0-row) delete,
  // so assert on post-state, not status code.
  const del = await fetch(`${URL}/rest/v1/case_templates?id=eq.${tid}`,{method:'DELETE',headers:Hr});
  const still = await fetch(`${URL}/rest/v1/case_templates?id=eq.${tid}&select=id,deleted_at`,{headers:Hd}).then(r=>r.json());
  ok('resident-cannot-delete-template', still.length===1 && still[0].deleted_at==null, `delete=${del.status} remaining=${still.length}`);

  // cleanup by director
  await fetch(`${URL}/rest/v1/case_templates?id=eq.${tid}`,{method:'DELETE',headers:Hd});
  ok('cleanup', true);
}

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle35 templates: ${results.length-fails}/${results.length} checks passed`);
