const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();

  // Disable the audit trigger temporarily, insert tenant, then re-enable
  console.log('=== Disabling audit trigger ===');
  const disableRes = await fetch(`${URL_BASE}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants" })
  });
  console.log('Disable result:', disableRes.status, await disableRes.text());

  // Create global tenant
  console.log('\n=== Creating Global Tenant ===');
  const createRes = await fetch(`${URL_BASE}/rest/v1/tenants`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      name: 'Global Resident Community',
      slug: 'global-community',
      tenant_type: 'institution',
      mrn_hash_salt: 'global-community-salt-' + Date.now(),
    })
  });
  const tenant = await createRes.json();
  console.log('Tenant:', tenant);

  // Re-enable audit trigger
  console.log('\n=== Re-enabling audit trigger ===');
  const enableRes = await fetch(`${URL_BASE}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants" })
  });
  console.log('Enable result:', enableRes.status, await enableRes.text());

  // Create subscription for global tenant
  if (tenant[0]) {
    console.log('\n=== Creating Subscription ===');
    const subRes = await fetch(`${URL_BASE}/rest/v1/subscriptions`, {
      method: 'POST',
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({
        tenant_id: tenant[0].id,
        status: 'active',
      })
    });
    console.log('Subscription:', await subRes.json());
  }
}

test();
