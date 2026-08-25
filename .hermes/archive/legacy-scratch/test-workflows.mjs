import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function testResidentWorkflow() {
  console.log('\n=== RESIDENT WORKFLOW TEST ===');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  await supabase.auth.signInWithPassword({ email: 'resident@demo.com', password: 'password123!' });
  
  // 1. Fetch case entries
  const { data: cases, error: e1 } = await supabase.from('case_entries').select('*').limit(10);
  console.log(`  CASE_ENTRIES: ${e1 ? 'FAIL - ' + e1.message : 'OK (' + (cases?.length || 0) + ' entries)'}`);
  if (cases?.length) cases.forEach(c => console.log(`    - ${c.title || c.id} [${c.status}]`));
  
  // 2. Fetch case templates
  const { data: templates, error: e2 } = await supabase.from('case_templates').select('*').limit(10);
  console.log(`  CASE_TEMPLATES: ${e2 ? 'FAIL - ' + e2.message : 'OK (' + (templates?.length || 0) + ' templates)'}`);
  if (templates?.length) templates.forEach(t => console.log(`    - ${t.name || t.id}`));
  
  // 3. Fetch approval requests
  const { data: approvals, error: e3 } = await supabase.from('approval_requests').select('*').limit(10);
  console.log(`  APPROVAL_REQUESTS: ${e3 ? 'FAIL - ' + e3.message : 'OK (' + (approvals?.length || 0) + ' requests)'}`);
  
  // 4. Fetch case attachments
  const { data: attachments, error: e4 } = await supabase.from('case_attachments').select('*').limit(10);
  console.log(`  CASE_ATTACHMENTS: ${e4 ? 'FAIL - ' + e4.message : 'OK (' + (attachments?.length || 0) + ' attachments)'}`);
  
  // 5. Fetch audit logs
  const { data: logs, error: e5 } = await supabase.from('audit_logs').select('*').limit(10);
  console.log(`  AUDIT_LOGS: ${e5 ? 'FAIL - ' + e5.message : 'OK (' + (logs?.length || 0) + ' logs)'}`);
  
  // 6. Fetch program goals
  const { data: goals, error: e6 } = await supabase.from('program_goals').select('*').limit(10);
  console.log(`  PROGRAM_GOALS: ${e6 ? 'FAIL - ' + e6.message : 'OK (' + (goals?.length || 0) + ' goals)'}`);
  
  // 7. Fetch goal progress
  const { data: progress, error: e7 } = await supabase.from('goal_progress').select('*').limit(10);
  console.log(`  GOAL_PROGRESS: ${e7 ? 'FAIL - ' + e7.message : 'OK (' + (progress?.length || 0) + ' entries)'}`);
  
  // 8. Create a new case entry
  console.log('\n  --- CREATE NEW CASE ENTRY ---');
  const newEntry = {
    title: `Auto Test Case ${Date.now()}`,
    template_id: templates?.[0]?.id || null,
    status: 'draft',
    field_values: JSON.stringify({ 
      procedure: 'Appendectomy',
      complexity: 'standard',
      outcome: 'successful',
      notes: 'Automated test entry'
    }),
  };
  
  const { data: created, error: e8 } = await supabase.from('case_entries').insert(newEntry).select().single();
  if (e8) {
    console.log(`  CREATE: FAIL - ${e8.message} (code: ${e8.code})`);
  } else {
    console.log(`  CREATE: OK (id: ${created.id}, title: ${created.title})`);
    
    // Update the case
    const { error: e9 } = await supabase.from('case_entries').update({ status: 'submitted' }).eq('id', created.id);
    console.log(`  UPDATE: ${e9 ? 'FAIL - ' + e9.message : 'OK (status -> submitted)'}`);
    
    // Verify
    const { data: verify } = await supabase.from('case_entries').select('*').eq('id', created.id).single();
    console.log(`  VERIFY: ${verify ? 'OK (status: ' + verify.status + ')' : 'FAIL'}`);
    
    // Delete test entry
    await supabase.from('case_attachments').delete().eq('case_id', created.id);
    await supabase.from('approval_requests').delete().eq('case_id', created.id);
    const { error: e12 } = await supabase.from('case_entries').delete().eq('id', created.id);
    console.log(`  CLEANUP: ${e12 ? 'FAIL - ' + e12.message : 'OK (test entry deleted)'}`);
  }
  
  return cases?.length || 0;
}

async function testSupervisorWorkflow() {
  console.log('\n=== SUPERVISOR WORKFLOW TEST ===');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  await supabase.auth.signInWithPassword({ email: 'supervisor@demo.com', password: 'password123!' });
  
  // 1. Fetch all case entries
  const { data: cases, error: e1 } = await supabase.from('case_entries').select('*').limit(20);
  console.log(`  ALL CASES: ${e1 ? 'FAIL - ' + e1.message : 'OK (' + (cases?.length || 0) + ' entries)'}`);
  if (cases?.length) cases.forEach(c => console.log(`    - ${c.title || c.id} [${c.status}] by ${c.user_id}`));
  
  // 2. Fetch pending approvals
  const { data: pending, error: e2 } = await supabase.from('approval_requests').select('*').eq('status', 'pending').limit(10);
  console.log(`  PENDING APPROVALS: ${e2 ? 'FAIL - ' + e2.message : 'OK (' + (pending?.length || 0) + ' pending)'}`);
  
  // 3. Fetch all profiles
  const { data: profiles, error: e3 } = await supabase.from('profiles').select('*');
  console.log(`  ALL PROFILES: ${e3 ? 'FAIL - ' + e3.message : 'OK (' + (profiles?.length || 0) + ' users)'}`);
  if (profiles?.length) profiles.forEach(p => console.log(`    - ${p.full_name || p.user_id} [${p.role}]`));
  
  return cases?.length || 0;
}

async function testAdminWorkflow() {
  console.log('\n=== INSTITUTION ADMIN WORKFLOW TEST ===');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  await supabase.auth.signInWithPassword({ email: 'admin@demo.com', password: 'password123!' });
  
  // 1. Tenants
  const { data: tenants, error: e1 } = await supabase.from('tenants').select('*');
  console.log(`  TENANTS: ${e1 ? 'FAIL - ' + e1.message : 'OK (' + (tenants?.length || 0) + ' tenants)'}`);
  tenants?.forEach(t => console.log(`    - ${t.name} (${t.slug})`));
  
  // 2. Institutions
  const { data: institutions, error: e2 } = await supabase.from('institutions').select('*');
  console.log(`  INSTITUTIONS: ${e2 ? 'FAIL - ' + e2.message : 'OK (' + (institutions?.length || 0) + ' institutions)'}`);
  
  // 3. Audit logs
  const { data: logs, error: e3 } = await supabase.from('audit_logs').select('*').limit(20);
  console.log(`  AUDIT_LOGS: ${e3 ? 'FAIL - ' + e3.message : 'OK (' + (logs?.length || 0) + ' logs)'}`);
  
  // 4. Subscription plans
  const { data: plans, error: e4 } = await supabase.from('subscription_plans').select('*');
  console.log(`  SUBSCRIPTION_PLANS: ${e4 ? 'FAIL - ' + e4.message : 'OK (' + (plans?.length || 0) + ' plans)'}`);
  
  // 5. AI config
  const { data: ai, error: e5 } = await supabase.from('ai_config').select('*');
  console.log(`  AI_CONFIG: ${e5 ? 'FAIL - ' + e5.message : 'OK (' + (ai?.length || 0) + ' configs)'}`);
  
  return tenants?.length || 0;
}

async function testPlatformAdminWorkflow() {
  console.log('\n=== PLATFORM ADMIN WORKFLOW TEST ===');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  await supabase.auth.signInWithPassword({ email: 'platform@demo.com', password: 'password123!' });
  
  // 1. All tenants
  const { data: tenants } = await supabase.from('tenants').select('*');
  console.log(`  ALL TENANTS: OK (${tenants?.length || 0})`);
  
  // 2. All subscriptions
  const { data: subs, error: e1 } = await supabase.from('subscriptions').select('*');
  console.log(`  SUBSCRIPTIONS: ${e1 ? 'FAIL - ' + e1.message : 'OK (' + (subs?.length || 0) + ')'}`);
  
  // 3. All payments
  const { data: payments, error: e2 } = await supabase.from('payments').select('*');
  console.log(`  PAYMENTS: ${e2 ? 'FAIL - ' + e2.message : 'OK (' + (payments?.length || 0) + ')'}`);
  
  // 4. Payment gateway config
  const { data: gw, error: e3 } = await supabase.from('payment_gateway_config').select('*');
  console.log(`  PAYMENT_GATEWAY_CONFIG: ${e3 ? 'FAIL - ' + e3.message : 'OK (' + (gw?.length || 0) + ')'}`);
  
  // 5. Resident AI toggle
  const { data: aiToggle, error: e4 } = await supabase.from('resident_ai_toggle').select('*');
  console.log(`  RESIDENT_AI_TOGGLE: ${e4 ? 'FAIL - ' + e4.message : 'OK (' + (aiToggle?.length || 0) + ')'}`);
  
  return 0;
}

// ===== MAIN =====
console.log('====================================================');
console.log('  E-LOGBOOK FULL WORKFLOW TEST SUITE');
console.log('====================================================');

await testResidentWorkflow();
await testSupervisorWorkflow();
await testAdminWorkflow();
await testPlatformAdminWorkflow();

console.log('\n====================================================');
console.log('  TEST COMPLETE');
console.log('====================================================');
