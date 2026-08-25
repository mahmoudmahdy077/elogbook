const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();

  // Check all templates with tenant info
  const templatesRes = await fetch(`${URL_BASE}/rest/v1/case_templates?select=id,name,specialty,tenant_id,tenants!inner(name,slug)`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const templates = await templatesRes.json();
  
  console.log('All templates:');
  templates.forEach(t => {
    const tenant = t.tenants;
    console.log(`   - ${t.name} (${t.specialty}) tenant: ${tenant?.name || 'N/A'} [${tenant?.slug || 'N/A'}] id: ${t.id}`);
  });
  
  // Check for duplicates by name+specialty+tenant
  const seen = new Map();
  const duplicates = [];
  for (const t of templates) {
    const key = `${t.name}|${t.specialty}|${t.tenant_id}`;
    if (seen.has(key)) {
      duplicates.push(t);
    } else {
      seen.set(key, t);
    }
  }
  
  if (duplicates.length > 0) {
    console.log('\nDuplicates found:', duplicates.length);
    for (const d of duplicates) {
      console.log(`   - ${d.name} (${d.specialty}) id: ${d.id}`);
    }
  } else {
    console.log('\nNo duplicates found');
  }
}

test();
