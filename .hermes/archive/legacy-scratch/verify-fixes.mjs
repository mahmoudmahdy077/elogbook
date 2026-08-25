const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function login(email, password) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return res.json();
}

async function supabaseQuery(token, path) {
  const res = await fetch(`${URL_BASE}${path}`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  return { status: res.status, data: await res.json() };
}

async function supabaseMutate(token, path, method, body) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: { 
      'apikey': KEY, 
      'Authorization': `Bearer ${token}`, 
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

async function run() {
  console.log('=== COMPREHENSIVE BUG FIX VERIFICATION ===\n');

  // Login as resident
  const residentAuth = await login('resident@demo.com', 'password123!');
  const residentToken = residentAuth.access_token;
  console.log('Resident logged in:', residentAuth.user?.id?.slice(0, 8));

  // Login as supervisor
  const supAuth = await login('supervisor@demo.com', 'password123!');
  const supToken = supAuth.access_token;
  console.log('Supervisor logged in:', supAuth.user?.id?.slice(0, 8));

  // Login as admin
  const adminAuth = await login('admin@demo.com', 'password123!');
  const adminToken = adminAuth.access_token;
  console.log('Admin logged in:', adminAuth.user?.id?.slice(0, 8));

  // BUG #1: Test case submission
  console.log('\n--- BUG #1: Case submission ---');
  
  // Create a case
  const { data: templates } = await supabaseQuery(residentToken, '/rest/v1/case_templates?select=id&limit=1');
  const templateId = templates?.[0]?.id;
  console.log('Template ID:', templateId);

  if (templateId) {
    const { status: createStatus, data: newCase } = await supabaseMutate(residentToken, '/rest/v1/case_entries', 'POST', {
      template_id: templateId,
      patient_mrn: 'MRN-TEST-' + Date.now(),
      patient_dob: '1990-01-01',
      case_date: new Date().toISOString().split('T')[0],
      field_values: JSON.stringify({ procedure_name: 'Test Appendectomy' }),
      status: 'draft'
    });
    console.log('Create case:', createStatus, newCase?.id ? 'OK' : 'FAIL');

    if (newCase?.id) {
      // Try to submit (change status to pending)
      const { status: submitStatus, data: submitted } = await supabaseMutate(residentToken, `/rest/v1/case_entries?id=eq.${newCase.id}`, 'PATCH', {
        status: 'pending'
      });
      console.log('Submit case:', submitStatus, submitted?.[0]?.status || 'no data');

      // Verify
      const { data: verify } = await supabaseQuery(residentToken, `/rest/v1/case_entries?id=eq.${newCase.id}&select=status`);
      console.log('Verify status:', verify?.[0]?.status);

      // Try to approve as supervisor
      const { status: approveStatus } = await supabaseMutate(supToken, `/rest/v1/case_entries?id=eq.${newCase.id}`, 'PATCH', {
        status: 'approved'
      });
      console.log('Supervisor approve:', approveStatus);

      // Verify approval
      const { data: approved } = await supabaseQuery(supToken, `/rest/v1/case_entries?id=eq.${newCase.id}&select=status`);
      console.log('Verify approved:', approved?.[0]?.status);

      // Cleanup
      await supabaseMutate(residentToken, `/rest/v1/case_entries?id=eq.${newCase.id}`, 'DELETE', {});
      console.log('Cleanup: case deleted');
    }
  }

  // BUG #2: Test cookie-based auth (via server action)
  console.log('\n--- BUG #2: Server-side auth ---');
  const serverRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const serverData = await serverRes.json();
  console.log('Server login:', serverRes.status, serverData.redirectUrl || serverData.error);

  // BUG #3: Test global templates
  console.log('\n--- BUG #3: Global templates ---');
  const { data: allTemplates, status: tStatus } = await supabaseQuery(residentToken, '/rest/v1/case_templates?select=id,name,tenant_id');
  console.log('Templates visible to resident:', tStatus, allTemplates?.length || 0);
  allTemplates?.forEach(t => console.log(`  - ${t.name} (tenant: ${t.tenant_id})`));

  // Additional: Test all role-based access
  console.log('\n--- Role-based access tests ---');
  
  // Resident: can read cases
  const { status: rCases } = await supabaseQuery(residentToken, '/rest/v1/case_entries?select=id&limit=1');
  console.log('Resident read cases:', rCases);

  // Supervisor: can read all tenant cases
  const { data: sCases, status: sCasesStatus } = await supabaseQuery(supToken, '/rest/v1/case_entries?select=id&limit=5');
  console.log('Supervisor read cases:', sCasesStatus, sCases?.length || 0);

  // Admin: can read tenants
  const { data: tenants, status: tRes } = await supabaseQuery(adminToken, '/rest/v1/tenants?select=id,name');
  console.log('Admin read tenants:', tRes, tenants?.length || 0);

  // Admin: can read profiles
  const { data: profiles, status: pRes } = await supabaseQuery(adminToken, '/rest/v1/profiles?select=id,role&limit=10');
  console.log('Admin read profiles:', pRes, profiles?.length || 0);

  // Admin: can read subscription plans
  const { data: plans, status: plRes } = await supabaseQuery(adminToken, '/rest/v1/subscription_plans?select=id,name');
  console.log('Admin read plans:', plRes, plans?.length || 0);

  console.log('\n=== VERIFICATION COMPLETE ===');
}

run().catch(e => console.error('Error:', e));
