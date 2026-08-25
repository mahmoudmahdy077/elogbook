import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

const accounts = [
  { email: 'resident@demo.com', password: 'password123!', role: 'resident' },
  { email: 'supervisor@demo.com', password: 'password123!', role: 'supervisor' },
  { email: 'director@demo.com', password: 'password123!', role: 'director' },
  { email: 'admin@demo.com', password: 'password123!', role: 'institution_admin' },
  { email: 'platform@demo.com', password: 'password123!', role: 'platform_admin' },
];

async function testAccount(account) {
  console.log(`\n--- Testing ${account.role} (${account.email}) ---`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  // 1. Test login
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  
  if (authError) {
    console.log(`  LOGIN FAILED: ${authError.message}`);
    return { ...account, login: false, error: authError.message };
  }
  
  console.log(`  LOGIN: OK (user_id: ${authData.user.id})`);
  console.log(`  ROLE from metadata: ${authData.user.user_metadata?.role || 'N/A'}`);
  console.log(`  TENANT from app_metadata: ${authData.user.app_metadata?.tenant_id || 'N/A'}`);
  
  // 2. Test profile fetch
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*, tenants!inner(*)')
    .eq('user_id', authData.user.id)
    .single();
  
  if (profileError) {
    console.log(`  PROFILE: FAILED - ${profileError.message}`);
  } else {
    console.log(`  PROFILE: OK (role: ${profile.role}, tenant: ${profile.tenants?.name || 'N/A'})`);
  }
  
  // 3. Test session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  console.log(`  SESSION: ${session ? 'Active' : 'None'} ${sessionError ? '(' + sessionError.message + ')' : ''}`);
  
  return { ...account, login: true, userId: authData.user.id, profile };
}

async function testResidentWorkflow(supabase) {
  console.log('\n=== RESIDENT WORKFLOW TEST ===');
  
  // 1. Fetch existing cases
  const { data: cases, error: casesError } = await supabase
    .from('cases')
    .select('*')
    .limit(10);
  
  if (casesError) {
    console.log(`  FETCH CASES: FAILED - ${casesError.message}`);
  } else {
    console.log(`  FETCH CASES: OK (${cases.length} cases found)`);
    cases.forEach(c => console.log(`    - ${c.title || c.procedure_name || c.id} (${c.status})`));
  }
  
  // 2. Fetch case templates
  const { data: templates, error: templatesError } = await supabase
    .from('case_templates')
    .select('*')
    .limit(10);
  
  if (templatesError) {
    console.log(`  FETCH TEMPLATES: FAILED - ${templatesError.message}`);
  } else {
    console.log(`  FETCH TEMPLATES: OK (${templates.length} templates found)`);
    templates.forEach(t => console.log(`    - ${t.name || t.id}`));
  }
  
  // 3. Fetch milestones
  const { data: milestones, error: milestonesError } = await supabase
    .from('milestones')
    .select('*')
    .limit(10);
  
  if (milestonesError) {
    console.log(`  FETCH MILESTONES: FAILED - ${milestonesError.message}`);
  } else {
    console.log(`  FETCH MILESTONES: OK (${milestones.length} milestones found)`);
  }
  
  // 4. Create a test case
  const testCase = {
    title: `Test Case - ${new Date().toISOString()}`,
    procedure_name: 'Test Procedure',
    status: 'draft',
    patient_age: 45,
    patient_sex: 'male',
    field_values: JSON.stringify({ notes: 'Test case created by automated test' }),
  };
  
  const { data: newCase, error: createError } = await supabase
    .from('cases')
    .insert(testCase)
    .select()
    .single();
  
  if (createError) {
    console.log(`  CREATE CASE: FAILED - ${createError.message}`);
    console.log(`    Code: ${createError.code}`);
    console.log(`    Details: ${createError.details}`);
  } else {
    console.log(`  CREATE CASE: OK (id: ${newCase.id})`);
    
    // Verify it exists
    const { data: verifyCase } = await supabase
      .from('cases')
      .select('*')
      .eq('id', newCase.id)
      .single();
    
    console.log(`  VERIFY CASE: ${verifyCase ? 'EXISTS' : 'NOT FOUND'}`);
    
    // Clean up
    await supabase.from('cases').delete().eq('id', newCase.id);
    console.log(`  CLEANUP: Test case deleted`);
  }
  
  return { cases: cases?.length || 0, templates: templates?.length || 0, milestones: milestones?.length || 0 };
}

async function testSupervisorWorkflow(supabase) {
  console.log('\n=== SUPERVISOR WORKFLOW TEST ===');
  
  // 1. Fetch pending approvals
  const { data: approvals, error: approvalsError } = await supabase
    .from('cases')
    .select('*')
    .eq('status', 'submitted')
    .limit(10);
  
  if (approvalsError) {
    console.log(`  FETCH PENDING APPROVALS: FAILED - ${approvalsError.message}`);
  } else {
    console.log(`  FETCH PENDING APPROVALS: OK (${approvals.length} pending)`);
  }
  
  // 2. Fetch all residents
  const { data: residents, error: residentsError } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'resident')
    .limit(10);
  
  if (residentsError) {
    console.log(`  FETCH RESIDENTS: FAILED - ${residentsError.message}`);
  } else {
    console.log(`  FETCH RESIDENTS: OK (${residents.length} residents)`);
  }
  
  return { approvals: approvals?.length || 0, residents: residents?.length || 0 };
}

async function testAdminWorkflow(supabase) {
  console.log('\n=== ADMIN WORKFLOW TEST ===');
  
  // 1. Fetch tenants
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('*')
    .limit(10);
  
  if (tenantsError) {
    console.log(`  FETCH TENANTS: FAILED - ${tenantsError.message}`);
  } else {
    console.log(`  FETCH TENANTS: OK (${tenants.length} tenants)`);
    tenants.forEach(t => console.log(`    - ${t.name} (slug: ${t.slug})`));
  }
  
  // 2. Fetch all users
  const { data: users, error: usersError } = await supabase
    .from('profiles')
    .select('*')
    .limit(20);
  
  if (usersError) {
    console.log(`  FETCH USERS: FAILED - ${usersError.message}`);
  } else {
    console.log(`  FETCH USERS: OK (${users.length} users)`);
    users.forEach(u => console.log(`    - ${u.full_name || u.user_id} (${u.role})`));
  }
  
  // 3. Fetch settings
  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('*')
    .limit(10);
  
  if (settingsError) {
    console.log(`  FETCH SETTINGS: ${settingsError.message}`);
  } else {
    console.log(`  FETCH SETTINGS: OK (${settings?.length || 0} settings)`);
  }
  
  // 4. Fetch evaluations
  const { data: evals, error: evalsError } = await supabase
    .from('evaluations')
    .select('*')
    .limit(10);
  
  if (evalsError) {
    console.log(`  FETCH EVALUATIONS: ${evalsError.message}`);
  } else {
    console.log(`  FETCH EVALUATIONS: OK (${evals?.length || 0} evaluations)`);
  }
  
  // 5. Fetch goals
  const { data: goals, error: goalsError } = await supabase
    .from('goals')
    .select('*')
    .limit(10);
  
  if (goalsError) {
    console.log(`  FETCH GOALS: ${goalsError.message}`);
  } else {
    console.log(`  FETCH GOALS: OK (${goals?.length || 0} goals)`);
  }
  
  return { tenants: tenants?.length || 0, users: users?.length || 0 };
}

// ===== MAIN =====
console.log('========================================');
console.log('  E-LOGBOOK COMPREHENSIVE TEST SUITE');
console.log('========================================');

// Test all accounts
const results = [];
for (const account of accounts) {
  const result = await testAccount(account);
  results.push(result);
}

console.log('\n========================================');
console.log('  LOGIN TEST SUMMARY');
console.log('========================================');
for (const r of results) {
  console.log(`  ${r.role.padEnd(20)} ${r.login ? 'PASS' : 'FAIL'} ${r.error || ''}`);
}

// Test resident workflow
const residentAccount = results.find(r => r.login && r.role === 'resident');
if (residentAccount) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  await supabase.auth.signInWithPassword({
    email: residentAccount.email,
    password: residentAccount.password,
  });
  await testResidentWorkflow(supabase);
}

// Test supervisor workflow
const supervisorAccount = results.find(r => r.login && r.role === 'supervisor');
if (supervisorAccount) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  await supabase.auth.signInWithPassword({
    email: supervisorAccount.email,
    password: supervisorAccount.password,
  });
  await testSupervisorWorkflow(supabase);
}

// Test admin workflow
const adminAccount = results.find(r => r.login && r.role === 'institution_admin');
if (adminAccount) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  await supabase.auth.signInWithPassword({
    email: adminAccount.email,
    password: adminAccount.password,
  });
  await testAdminWorkflow(supabase);
}

console.log('\n========================================');
console.log('  ALL TESTS COMPLETE');
console.log('========================================');
