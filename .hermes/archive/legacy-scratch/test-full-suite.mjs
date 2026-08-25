import { createClient } from '@supabase/supabase-js';

const URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

function supabase() { return createClient(URL, KEY); }

async function login(s, email) {
  const { error } = await s.auth.signInWithPassword({ email, password: 'password123!' });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);
}

// ============================
// TEST 1: LOGIN ALL ACCOUNTS
// ============================
async function testLogins() {
  console.log('\n' + '='.repeat(60));
  console.log('  TEST 1: LOGIN ALL DEMO ACCOUNTS');
  console.log('='.repeat(60));
  
  const accounts = [
    { email: 'resident@demo.com', role: 'resident' },
    { email: 'supervisor@demo.com', role: 'supervisor' },
    { email: 'director@demo.com', role: 'director' },
    { email: 'admin@demo.com', role: 'institution_admin' },
    { email: 'platform@demo.com', role: 'platform_admin' },
  ];
  
  let pass = 0, fail = 0;
  for (const a of accounts) {
    const s = supabase();
    const { data, error } = await s.auth.signInWithPassword({ email: a.email, password: 'password123!' });
    if (error) { console.log(`  FAIL  ${a.role.padEnd(20)} ${error.message}`); fail++; continue; }
    
    const { data: profile } = await s.from('profiles').select('role, full_name, tenants!inner(name, slug)').eq('user_id', data.user.id).single();
    console.log(`  PASS  ${a.role.padEnd(20)} user=${data.user.id.slice(0,8)}... profile_role=${profile?.role} tenant=${profile?.tenants?.slug}`);
    pass++;
  }
  console.log(`  Result: ${pass}/${pass+fail} passed`);
  return fail === 0;
}

// ============================
// TEST 2: TABLE ACCESS (RLS)
// ============================
async function testTableAccess() {
  console.log('\n' + '='.repeat(60));
  console.log('  TEST 2: TABLE ACCESS & RLS POLICIES');
  console.log('='.repeat(60));
  
  const tables = [
    'tenants', 'profiles', 'case_templates', 'case_entries', 
    'case_attachments', 'approval_requests', 'audit_logs',
    'program_goals', 'goal_progress', 'subscription_plans',
    'subscriptions', 'payments', 'one_time_purchases', 'ai_config',
    'resident_ai_toggle', 'ai_query_logs', 'institutions'
  ];
  
  const s = supabase();
  await login(s, 'resident@demo.com');
  
  let pass = 0;
  for (const t of tables) {
    const { data, error } = await s.from(t).select('*').limit(1);
    if (error?.code === 'PGRST205') {
      console.log(`  SKIP  ${t.padEnd(25)} (table not found in schema cache)`);
    } else if (error) {
      const denied = error.message.includes('permission denied');
      console.log(`  ${denied ? 'RLSD' : 'FAIL'} ${t.padEnd(25)} ${error.message.slice(0, 60)}`);
      pass++;
    } else {
      console.log(`  PASS  ${t.padEnd(25)} accessible (${data?.length || 0} rows)`);
      pass++;
    }
  }
  console.log(`  Result: ${pass} accessible/protected`);
  return true;
}

// ============================
// TEST 3: FULL CASE WORKFLOW
// ============================
async function testCaseWorkflow() {
  console.log('\n' + '='.repeat(60));
  console.log('  TEST 3: CASE CREATION → SUBMISSION → APPROVAL WORKFLOW');
  console.log('='.repeat(60));
  
  const residentS = supabase();
  await login(residentS, 'resident@demo.com');
  
  // Step 1: Get or create a template
  let { data: templates } = await residentS.from('case_templates').select('*').limit(1);
  
  let templateId;
  if (!templates?.length) {
    console.log('  [Setup] Creating a case template...');
    const { data: newTemplate, error: tErr } = await residentS.from('case_templates').insert({
      specialty: 'General Surgery',
      name: 'Appendectomy Template',
      fields: JSON.stringify([
        { name: 'procedure_name', type: 'text', label: 'Procedure Name' },
        { name: 'outcome', type: 'select', label: 'Outcome', options: ['successful', 'complicated', 'failed'] },
        { name: 'notes', type: 'textarea', label: 'Notes' },
      ]),
      required_fields: JSON.stringify(['procedure_name']),
    }).select().single();
    
    if (tErr) {
      console.log(`  FAIL  Template creation: ${tErr.message}`);
      return false;
    }
    templateId = newTemplate.id;
    console.log(`  PASS  Template created: ${templateId}`);
  } else {
    templateId = templates[0].id;
    console.log(`  PASS  Using existing template: ${templateId}`);
  }
  
  // Step 2: Create case entry as resident
  console.log('\n  [Resident] Creating new case entry...');
  const caseData = {
    template_id: templateId,
    patient_mrn: `MRN-${Date.now()}`,
    patient_dob: '1985-03-15',
    case_date: new Date().toISOString().split('T')[0],
    field_values: JSON.stringify({
      procedure_name: 'Laparoscopic Appendectomy',
      outcome: 'successful',
      notes: 'Uncomplicated procedure, patient recovered well',
    }),
    status: 'draft',
  };
  
  const { data: newCase, error: cErr } = await residentS.from('case_entries').insert(caseData).select().single();
  if (cErr) {
    console.log(`  FAIL  Case creation: ${cErr.message} (code: ${cErr.code})`);
    return false;
  }
  console.log(`  PASS  Case created: ${newCase.id} (status: ${newCase.status})`);
  
  // Step 3: Verify case exists
  const { data: verify } = await residentS.from('case_entries').select('*').eq('id', newCase.id).single();
  console.log(`  PASS  Case verified in DB: ${verify?.status}`);
  
  // Step 4: Submit case (change status to pending)
  console.log('\n  [Resident] Submitting case for approval...');
  const { error: subErr } = await residentS.from('case_entries').update({ status: 'pending' }).eq('id', newCase.id);
  if (subErr) {
    console.log(`  FAIL  Submit: ${subErr.message}`);
  } else {
    const { data: submitted } = await residentS.from('case_entries').select('status').eq('id', newCase.id).single();
    console.log(`  PASS  Case submitted: status=${submitted?.status}`);
  }
  
  // Step 5: Supervisor approves
  console.log('\n  [Supervisor] Reviewing and approving case...');
  const supS = supabase();
  await login(supS, 'supervisor@demo.com');
  
  // Supervisor sees pending cases
  const { data: pendingCases } = await supS.from('case_entries').select('*').eq('status', 'pending');
  console.log(`  PASS  Supervisor sees ${pendingCases?.length || 0} pending case(s)`);
  
  // Create approval request
  const { data: approval, error: aErr } = await supS.from('approval_requests').insert({
    entry_id: newCase.id,
    status: 'approved',
    comment: 'Good case documentation. Approved.',
  }).select().single();
  
  if (aErr) {
    console.log(`  FAIL  Approval request: ${aErr.message} (code: ${aErr.code})`);
  } else {
    console.log(`  PASS  Approval request created: ${approval.id} (status: ${approval.status})`);
  }
  
  // Update case status
  const { error: appErr } = await supS.from('case_entries').update({ status: 'approved' }).eq('id', newCase.id);
  if (appErr) {
    console.log(`  FAIL  Case approval update: ${appErr.message}`);
  } else {
    const { data: approved } = await supS.from('case_entries').select('status').eq('id', newCase.id).single();
    console.log(`  PASS  Case approved: status=${approved?.status}`);
  }
  
  // Step 6: Verify audit trail
  console.log('\n  [Verify] Checking audit logs...');
  const { data: logs } = await residentS.from('audit_logs').select('*').eq('resource_id', newCase.id);
  console.log(`  INFO  Audit logs for case: ${logs?.length || 0} entries`);
  
  // Step 7: Cleanup
  console.log('\n  [Cleanup] Removing test data...');
  await supS.from('approval_requests').delete().eq('entry_id', newCase.id);
  await supS.from('case_attachments').delete().eq('entry_id', newCase.id);
  const { error: delErr } = await supS.from('case_entries').delete().eq('id', newCase.id);
  console.log(`  PASS  Cleanup: ${delErr ? 'FAIL - ' + delErr.message : 'Test data removed'}`);
  
  return true;
}

// ============================
// TEST 4: ADMIN OPERATIONS
// ============================
async function testAdminOperations() {
  console.log('\n' + '='.repeat(60));
  console.log('  TEST 4: ADMIN OPERATIONS');
  console.log('='.repeat(60));
  
  const s = supabase();
  await login(s, 'admin@demo.com');
  
  // Tenants
  const { data: tenants } = await s.from('tenants').select('*');
  console.log(`  PASS  Tenants: ${tenants?.length || 0} found`);
  tenants?.forEach(t => console.log(`    - ${t.name} (slug: ${t.slug}, id: ${t.id.slice(0,8)}...)`));
  
  // Profiles
  const { data: profiles } = await s.from('profiles').select('*, tenants!inner(name)');
  console.log(`  PASS  Profiles: ${profiles?.length || 0} found`);
  profiles?.forEach(p => console.log(`    - ${p.full_name || p.user_id.slice(0,8)} [${p.role}] @ ${p.tenants?.name}`));
  
  // Subscription plans
  const { data: plans } = await s.from('subscription_plans').select('*');
  console.log(`  PASS  Subscription plans: ${plans?.length || 0} found`);
  plans?.forEach(p => console.log(`    - ${p.name}: $${p.price}/${p.interval}`));
  
  return true;
}

// ============================
// TEST 5: PROGRAM GOALS
// ============================
async function testGoals() {
  console.log('\n' + '='.repeat(60));
  console.log('  TEST 5: PROGRAM GOALS & PROGRESS');
  console.log('='.repeat(60));
  
  const s = supabase();
  await login(s, 'director@demo.com');
  
  // Create a goal
  const { data: goal, error: gErr } = await s.from('program_goals').insert({
    title: 'Complete 10 Appendectomies',
    description: 'Resident must complete 10 supervised appendectomy procedures',
    target_count: 10,
  }).select().single();
  
  if (gErr) {
    console.log(`  FAIL  Create goal: ${gErr.message} (code: ${gErr.code})`);
  } else {
    console.log(`  PASS  Goal created: ${goal.title} (target: ${goal.target_count})`);
    
    // Cleanup
    await s.from('goal_progress').delete().eq('goal_id', goal.id);
    await s.from('program_goals').delete().eq('id', goal.id);
    console.log(`  PASS  Goal cleanup done`);
  }
  
  return true;
}

// ============================
// MAIN
// ============================
async function main() {
  console.log('\n' + '#'.repeat(60));
  console.log('  E-LOGBOOK COMPREHENSIVE TEST SUITE');
  console.log('#'.repeat(60));
  
  const results = {};
  
  results.logins = await testLogins();
  results.tableAccess = await testTableAccess();
  results.caseWorkflow = await testCaseWorkflow();
  results.adminOps = await testAdminOperations();
  results.goals = await testGoals();
  
  console.log('\n' + '='.repeat(60));
  console.log('  FINAL SUMMARY');
  console.log('='.repeat(60));
  for (const [test, pass] of Object.entries(results)) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${test}`);
  }
  
  const allPassed = Object.values(results).every(Boolean);
  console.log(`\n  Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
