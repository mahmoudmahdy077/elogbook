const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();

  // Check all templates without tenant filter
  const templatesRes = await fetch(`${URL_BASE}/rest/v1/case_templates?select=id,name,specialty,tenant_id`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const templates = await templatesRes.json();
  
  console.log('All templates (no filter):', templates.length);
  templates.forEach(t => {
    console.log(`   - ${t.name} (${t.specialty}) tenant: ${t.tenant_id} id: ${t.id}`);
  });
  
  // Check for duplicates
  const seen = new Map();
  const duplicates = [];
  for (const t of templates) {
    const key = `${t.tenant_id}|${t.name}|${t.specialty}`;
    if (seen.has(key)) {
      duplicates.push(t);
    } else {
      seen.set(key, t);
    }
  }
  
  if (duplicates.length > 0) {
    console.log('\nDuplicates:');
    for (const d of duplicates) {
      console.log(`   - ${d.name} (${d.specialty}) tenant: ${d.tenant_id} id: ${d.id}`);
    }
  }
}

test();
