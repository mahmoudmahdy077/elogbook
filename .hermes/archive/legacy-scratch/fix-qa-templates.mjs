const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();

  // Check QA E2E Institution templates
  const templatesRes = await fetch(`${URL_BASE}/rest/v1/case_templates?select=id,name,specialty,tenant_id&tenant_id=eq.11111111-1111-1111-1111-111111111111`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const templates = await templatesRes.json();
  
  console.log('QA E2E templates:', templates.length);
  templates.forEach(t => {
    console.log(`   - ${t.name} (${t.specialty}) id: ${t.id}`);
  });
  
  // Check for duplicates
  const seen = new Map();
  const duplicates = [];
  for (const t of templates) {
    const key = `${t.name}|${t.specialty}`;
    if (seen.has(key)) {
      duplicates.push(t);
    } else {
      seen.set(key, t);
    }
  }
  
  if (duplicates.length > 0) {
    console.log('\nDuplicates:');
    for (const d of duplicates) {
      console.log(`   - ${d.name} (${d.specialty}) id: ${d.id}`);
    }
    
    // Delete duplicates
    for (const d of duplicates) {
      const delRes = await fetch(`${URL_BASE}/rest/v1/case_templates?id=eq.${d.id}`, {
        method: 'DELETE',
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
      });
      console.log(`   Deleted ${d.id}: ${delRes.status}`);
    }
  }
}

test();
