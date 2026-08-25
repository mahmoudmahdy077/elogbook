const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  console.log('=== TENANT & GLOBAL TENANT TEST ===\n');

  // 1. Login as admin
  const loginRes = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'password123!' })
  });
  const auth = await loginRes.json();
  const token = auth.access_token;
  console.log('1. Admin login: OK');

  // 2. Check tenants
  const tenantsRes = await fetch(`${URL_BASE}/rest/v1/tenants?select=id,name,slug,tenant_type`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const tenants = await tenantsRes.json();
  console.log('\n2. Tenants:');
  tenants.forEach(t => console.log(`   - ${t.name} (${t.slug}) [${t.tenant_type}]`));

  // 3. Check global community tenant
  const globalTenant = tenants.find(t => t.slug === 'global-community');
  console.log('\n3. Global Community Tenant:', globalTenant ? 'EXISTS' : 'NOT FOUND');
  if (globalTenant) {
    console.log(`   ID: ${globalTenant.id}`);
    console.log(`   Name: ${globalTenant.name}`);
    console.log(`   Type: ${globalTenant.tenant_type}`);
  }

  // 4. Check profiles and their tenants
  const profilesRes = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,full_name,role,tenant_id&limit=10`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const profiles = await profilesRes.json();
  console.log('\n4. Profiles:');
  profiles.forEach(p => console.log(`   - ${p.full_name || 'N/A'} [${p.role}] tenant: ${p.tenant_id.slice(0, 8)}...`));

  // 5. Check invites
  const invitesRes = await fetch(`${URL_BASE}/rest/v1/tenant_invites?select=*&limit=5`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const invites = await invitesRes.json();
  console.log('\n5. Invites:', invites.length, 'found');
  invites.forEach(i => console.log(`   - ${i.email} [${i.role}] status: ${i.status}`));

  // 6. Test registration link generation
  console.log('\n6. Registration Links:');
  tenants.forEach(t => {
    console.log(`   - ${t.name}: http://localhost:3000/signup?tenant=${t.slug}`);
  });

  // 7. Check subscriptions
  const subsRes = await fetch(`${URL_BASE}/rest/v1/subscriptions?select=*,tenants!inner(name,slug)`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const subs = await subsRes.json();
  console.log('\n7. Subscriptions:');
  subs.forEach(s => console.log(`   - ${s.tenants?.name || 'N/A'}: ${s.status}`));
}

test();
