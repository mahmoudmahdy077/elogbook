const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();

  // 1. Create global tenant for new residents
  console.log('\n=== Creating Global Tenant ===');
  const globalTenantRes = await fetch(`${URL_BASE}/rest/v1/tenants`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      name: 'Global Resident Community',
      slug: 'global-community',
      tenant_type: 'institution',
      mrn_hash_salt: 'global-community-salt-' + Date.now(),
    })
  });
  const globalTenant = await globalTenantRes.json();
  console.log('Global tenant:', globalTenant);
  
  // 2. Create subscription for global tenant
  console.log('\n=== Creating Subscription for Global Tenant ===');
  if (globalTenant[0]) {
    const subRes = await fetch(`${URL_BASE}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({
        tenant_id: globalTenant[0].id,
        status: 'active',
      })
    });
    console.log('Subscription:', await subRes.json());
  }
}

test();
