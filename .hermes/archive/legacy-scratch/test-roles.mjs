const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

// Expected menus per role
const EXPECTED_MENUS = {
  resident: ['Dashboard', 'Cases', 'Goals', 'Reports', 'My Evaluations', 'Duty Hours', 'Settings'],
  supervisor: ['Dashboard', 'Cases', 'Approvals', 'Goals', 'Reports', 'Evaluate', 'Duty Hours', 'Settings'],
  director: ['Dashboard', 'Cases', 'Approvals', 'Goals', 'Milestones', 'Rotations', 'Reports', 'Evaluate', 'Duty Hours', 'Analytics', 'Audit', 'Compliance', 'Settings'],
  institution_admin: ['Dashboard', 'Cases', 'Approvals', 'Goals', 'Milestones', 'Rotations', 'Reports', 'Evaluate', 'Duty Hours', 'Billing', 'Analytics', 'Audit', 'Compliance', 'Admin', 'Settings'],
  admin: ['Dashboard', 'Cases', 'Approvals', 'Goals', 'Milestones', 'Rotations', 'Reports', 'Evaluate', 'Duty Hours', 'Billing', 'Analytics', 'Audit', 'Compliance', 'Admin', 'Settings'],
};

async function testRole(role, email, password) {
  console.log(`\n=== Testing ${role.toUpperCase()} (${email}) ===`);
  
  // Login
  const loginRes = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const authData = await loginRes.json();
  
  if (!authData.access_token) {
    console.log(`  LOGIN: FAIL - ${authData.error_description || authData.msg}`);
    return { role, login: false };
  }
  console.log(`  LOGIN: OK (user_id: ${authData.user.id.slice(0, 8)}...)`);
  
  const token = authData.access_token;
  
  // Get profile
  const profileRes = await fetch(`${URL_BASE}/rest/v1/profiles?select=*,tenants!inner(name,slug,tenant_type)&user_id=eq.${authData.user.id}`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const profiles = await profileRes.json();
  const profile = profiles[0];
  
  if (!profile) {
    console.log(`  PROFILE: FAIL - No profile found`);
    return { role, login: true, profile: false };
  }
  
  console.log(`  PROFILE: OK`);
  console.log(`    Name: ${profile.full_name || 'N/A'}`);
  console.log(`    Role: ${profile.role}`);
  console.log(`    Specialty: ${profile.specialty || 'N/A'}`);
  console.log(`    Email: ${authData.user.email}`);
  console.log(`    Tenant: ${profile.tenants?.name || 'N/A'} (${profile.tenants?.slug})`);
  console.log(`    Tenant Type: ${profile.tenants?.tenant_type || 'N/A'}`);
  
  // Verify role matches
  const roleMatch = profile.role === role;
  console.log(`    Role Match: ${roleMatch ? 'YES' : 'NO - Expected: ' + role + ', Got: ' + profile.role}`);
  
  // Check expected menus
  const expectedMenus = EXPECTED_MENUS[role] || [];
  console.log(`  MENUS: Expected ${expectedMenus.length} items`);
  console.log(`    ${expectedMenus.join(', ')}`);
  
  // Verify role-based access
  console.log(`  ACCESS CHECKS:`);
  
  // Check cases access
  const casesRes = await fetch(`${URL_BASE}/rest/v1/case_entries?select=id&limit=1`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  console.log(`    Cases: ${casesRes.status === 200 ? 'OK' : 'FAIL'}`);
  
  // Check approvals access (supervisor+ only)
  const approvalsRes = await fetch(`${URL_BASE}/rest/v1/approval_requests?select=id&limit=1`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  console.log(`    Approvals: ${approvalsRes.status === 200 ? 'OK' : 'FAIL'}`);
  
  // Check admin access (admin only)
  const adminRes = await fetch(`${URL_BASE}/rest/v1/tenants?select=id&limit=1`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  console.log(`    Tenants: ${adminRes.status === 200 ? 'OK' : 'FAIL'}`);
  
  return { role, login: true, profile: true, roleMatch };
}

async function runTests() {
  console.log('========================================');
  console.log('  E-LOGBOOK ROLE-BASED ACCESS TEST');
  console.log('========================================');
  
  const accounts = [
    { role: 'resident', email: 'resident@demo.com', password: 'password123!' },
    { role: 'supervisor', email: 'supervisor@demo.com', password: 'password123!' },
    { role: 'director', email: 'director@demo.com', password: 'password123!' },
    { role: 'institution_admin', email: 'admin@demo.com', password: 'password123!' },
    { role: 'admin', email: 'platform@demo.com', password: 'password123!' },
  ];
  
  const results = [];
  for (const account of accounts) {
    const result = await testRole(account.role, account.email, account.password);
    results.push(result);
  }
  
  console.log('\n========================================');
  console.log('  TEST SUMMARY');
  console.log('========================================');
  
  for (const r of results) {
    const status = r.login && r.profile && r.roleMatch ? 'PASS' : 'FAIL';
    console.log(`  ${r.role.padEnd(20)} ${status}`);
  }
  
  const allPassed = results.every(r => r.login && r.profile && r.roleMatch);
  console.log(`\n  Overall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
}

runTests().catch(e => console.error('Error:', e));
