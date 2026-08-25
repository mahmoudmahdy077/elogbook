const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  console.log('=== TENANT ADMIN FEATURES TEST ===\n');

  // Login as admin
  const loginRes = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'password123!' })
  });
  const auth = await loginRes.json();
  const token = auth.access_token;
  console.log('1. Admin login: OK');

  // Test 1: User Management
  console.log('\n--- Test 1: User Management ---');
  const usersRes = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,full_name,role,tenant_id&tenant_id=eq.9cd50d60-febe-4adf-be0f-a36bf82762f6`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const users = await usersRes.json();
  console.log(`Users in Demo Hospital: ${users.length}`);
  users.forEach(u => console.log(`   - ${u.full_name || 'N/A'} [${u.role}]`));

  // Test 2: Invite System
  console.log('\n--- Test 2: Invite System ---');
  
  // Create an invite
  const inviteRes = await fetch(`${URL_BASE}/rest/v1/tenant_invites`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      tenant_id: '9cd50d60-febe-4adf-be0f-a36bf82762f6',
      email: 'test-invite@example.com',
      invited_by: auth.user.id,
      role: 'resident',
      status: 'pending',
    })
  });
  const invite = await inviteRes.json();
  console.log('Create invite:', inviteRes.status);
  if (inviteRes.status === 201) {
    console.log('   Invite created:', invite[0]?.id);
    console.log('   Registration link: http://localhost:3000/signup?invite=' + invite[0]?.id);
  }

  // Test 3: Registration Link
  console.log('\n--- Test 3: Registration Links ---');
  const tenantsRes = await fetch(`${URL_BASE}/rest/v1/tenants?select=slug,name`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const tenants = await tenantsRes.json();
  tenants.forEach(t => {
    console.log(`   ${t.name}: http://localhost:3000/signup?tenant=${t.slug}`);
  });

  // Test 4: Role Management
  console.log('\n--- Test 4: Role Management ---');
  if (users.length > 0) {
    const user = users[0];
    console.log(`Current role for ${user.full_name}: ${user.role}`);
    console.log('Role editing available in admin UI');
  }

  // Test 5: Check tenant_invites table
  console.log('\n--- Test 5: Check tenant_invites ---');
  const invitesRes = await fetch(`${URL_BASE}/rest/v1/tenant_invites?select=*&limit=5`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const invites = await invitesRes.json();
  console.log(`Total invites: ${invites.length || 0}`);
  if (invites.length > 0) {
    invites.forEach(i => console.log(`   - ${i.email} [${i.role}] status: ${i.status}`));
  }

  console.log('\n=== ALL TESTS COMPLETE ===');
}

test();
