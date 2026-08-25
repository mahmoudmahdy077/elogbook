const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();

  // Check for duplicate templates
  const templatesRes = await fetch(`${URL_BASE}/rest/v1/case_templates?select=id,name,specialty,tenant_id`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const templates = await templatesRes.json();
  
  console.log('Templates:', templates.length);
  
  // Find duplicates
  const seen = new Map();
  const duplicates = [];
  for (const t of templates) {
    const key = `${t.tenant_id}|${t.name}|${t.specialty}`;
    if (seen.has(key)) {
      duplicates.push({ ...t, original: seen.get(key) });
    } else {
      seen.set(key, t);
    }
  }
  
  console.log('\nDuplicates found:', duplicates.length);
  duplicates.forEach(d => {
    console.log(`   - ${d.name} (${d.specialty}) tenant: ${d.tenant_id.slice(0, 8)}`);
    console.log(`     Original: ${d.original.id}`);
    console.log(`     Duplicate: ${d.id}`);
  });
  
  // Delete duplicates
  if (duplicates.length > 0) {
    console.log('\nDeleting duplicates...');
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
