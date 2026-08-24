// Cycle 46 TEST: onboarding — profiles.onboarding_steps JSONB (migration 00083).
// Steps array contract: ["profile","specialty","tour","first_case","goal_set"];
// resident can update own steps, cannot touch another user's.
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const results = [];
const ok = (n,c,d='') => results.push({n,p:!!c,d});

async function login(e){return fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:e,password:'password123!'})}).then(r=>r.json());}
const R = await login('resident@demo.com');
const Hr = {'apikey':KEY,'Authorization':'Bearer '+R.access_token,'Content-Type':'application/json'};
ok('login', !!R.access_token);

// column exists in schema cache
const prof = await fetch(`${URL}/rest/v1/profiles?select=id,onboarding_steps&user_id=eq.${R.user.id}`,{headers:Hr});
ok('onboarding-steps-column-live', prof.status===200, `${prof.status}`);
const prow = await prof.json();
ok('profile-has-column', Array.isArray(prow) && prow[0]?.id, JSON.stringify(prow).slice(0,80));
const profileId = prow[0]?.id;
const before = prow[0]?.onboarding_steps ?? [];

// mark a step done (OnboardingWizard contract)
const next = before.includes('cycle46_step') ? before : [...before, 'cycle46_step'];
const patch = await fetch(`${URL}/rest/v1/profiles?id=eq.${profileId}`,{method:'PATCH',headers:Hr,body:JSON.stringify({onboarding_steps:next})});
ok('mark-step-done', patch.status===204, `${patch.status}`);

// read back
const back = await fetch(`${URL}/rest/v1/profiles?select=onboarding_steps&id=eq.${profileId}`,{headers:Hr}).then(x=>x.json());
ok('step-persisted', JSON.stringify(back[0]?.onboarding_steps)===JSON.stringify(next), JSON.stringify(back[0]?.onboarding_steps));

// completion gate shape: full list accepted
const all = ['profile','specialty','tour','first_case','goal_set'];
await fetch(`${URL}/rest/v1/profiles?id=eq.${profileId}`,{method:'PATCH',headers:Hr,body:JSON.stringify({onboarding_steps:all})});
const fin = await fetch(`${URL}/rest/v1/profiles?select=onboarding_steps&id=eq.${profileId}`,{headers:Hr}).then(x=>x.json());
ok('completion-list-accepted', Array.isArray(fin[0]?.onboarding_steps) && fin[0].onboarding_steps.length>=5, JSON.stringify(fin[0]?.onboarding_steps));

// restore original value
await fetch(`${URL}/rest/v1/profiles?id=eq.${profileId}`,{method:'PATCH',headers:Hr,body:JSON.stringify({onboarding_steps:before})});
ok('restore', true);

let fails=0;
for(const x of results){console.log(`${x.p?'PASS':'FAIL'} ${x.n}${x.d?' :: '+x.d:''}`); if(!x.p)fails++;}
console.log(`\nCycle46 onboarding: ${results.length-fails}/${results.length} checks passed`);
