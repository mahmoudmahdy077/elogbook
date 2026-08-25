const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Check tenants
  const tenants = await fetch(`${URL_BASE}/rest/v1/tenants?select=id,name,slug,tenant_type`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const data = await tenants.json();
  console.log('Tenants:', data);
  
  // Check global tenant ID
  const globalTenant = data.find(t => t.slug === 'global' || t.tenant_type === 'individual');
  console.log('\nGlobal tenant:', globalTenant || 'Not found');
  
  // Check existing profiles and their tenants
  const profiles = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,user_id,role,tenant_id,full_name&limit=10`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const profilesData = await profiles.json();
  console.log('\nProfiles:', profilesData);
}

test();
