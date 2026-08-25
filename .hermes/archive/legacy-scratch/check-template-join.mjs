const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Check cases with template join (like the page does)
  const casesRes = await fetch(`${URL_BASE}/rest/v1/case_entries?select=id,template_id,resident_id,status,case_templates!inner(name,specialty)&limit=20`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const cases = await casesRes.json();
  console.log('Cases with template join:', cases.length);
  
  // Check cases without template join
  const casesRes2 = await fetch(`${URL_BASE}/rest/v1/case_entries?select=id,template_id,resident_id,status&limit=20`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const cases2 = await casesRes2.json();
  console.log('Cases without join:', cases2.length);
  
  // Find cases that are in cases2 but not in cases1
  const caseIds1 = new Set(cases.map(c => c.id));
  const missing = cases2.filter(c => !caseIds1.has(c.id));
  console.log('\nCases missing from join:', missing.length);
  for (const m of missing) {
    console.log(`  ${m.id}: template_id=${m.template_id}, status=${m.status}`);
  }
}

test();
