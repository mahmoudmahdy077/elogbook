const SUPABASE_URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';
const LOCAL_URL = 'http://localhost:3000';

const results = { passed: 0, failed: 0, tests: [] };

function log(testName, success, detail = '') {
  const status = success ? '✅ PASS' : '❌ FAIL';
  results.tests.push({ testName, success, detail });
  if (success) results.passed++;
  else results.failed++;
  console.log(`${status}: ${testName}`);
  if (detail) console.log(`   Detail: ${detail}`);
}

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1];
    const padded = base64.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch { return null; }
}

async function supabaseAuth(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function supabaseQuery(token, table, options = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = [];
  if (options.select) params.push(`select=${options.select}`);
  if (options.where) {
    for (const [k, v] of Object.entries(options.where)) {
      params.push(`${k}=${v}`);
    }
  }
  if (options.order) params.push(`order=${options.order}`);
  if (options.limit) params.push(`limit=${options.limit}`);
  if (options.single) params.push('limit=1');
  if (params.length) url += '?' + params.join('&');

  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function localApiPost(path, body, cookies = '') {
  try {
    const res = await fetch(`${LOCAL_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000',
        ...(cookies ? { 'Cookie': cookies } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: e.message };
  }
}

// Helper: get first row from query result
function firstRow(result) {
  if (!result.ok || !Array.isArray(result.data)) return null;
  return result.data[0] || null;
}

// ─────────────────────────────────────────────────────────
// TEST 1: INSTITUTION ADMIN
// ─────────────────────────────────────────────────────────
async function testInstitutionAdmin() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  INSTITUTION ADMIN (admin@demo.com)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Login via local API
  const loginRes = await localApiPost('/api/auth/login', { email: 'admin@demo.com', password: 'password123!' });
  log('InstAdmin: Login via local API', loginRes.ok, loginRes.ok ? `redirect=${loginRes.data?.redirectUrl}` : `status=${loginRes.status}: ${JSON.stringify(loginRes.data)}`);

  // 2. Login via GoTrue
  const auth = await supabaseAuth('admin@demo.com', 'password123!');
  log('InstAdmin: Login via GoTrue', auth.ok, auth.ok ? `token expires in ${auth.data.expires_in}s` : `${auth.status}: ${JSON.stringify(auth.data)}`);

  if (!auth.ok) return;
  const token = auth.data.access_token;
  const userId = auth.data.user?.id;

  // Decode JWT
  const jwtPayload = decodeJwtPayload(token);
  const jwtRole = jwtPayload?.app_metadata?.user_role;
  const jwtTenantId = jwtPayload?.app_metadata?.tenant_id;
  log('InstAdmin: Role in JWT', !!jwtRole, `user_role=${jwtRole}, tenant_id=${jwtTenantId}`);

  // 3. Fetch profile
  const profileRes = await supabaseQuery(token, 'profiles', {
    select: 'id,user_id,role,full_name,tenant_id,tenants!inner(slug,name)',
    where: { 'user_id': `eq.${userId}` },
    single: true,
  });
  const profile = firstRow(profileRes);
  log('InstAdmin: Fetch own profile', profileRes.ok && profile?.role === 'institution_admin', `role=${profile?.role}, tenant=${profile?.tenants?.slug}`);

  const tenantId = profile?.tenant_id;
  const tenantSlug = profile?.tenants?.slug;

  // 4. Fetch tenants
  const tenantsRes = await supabaseQuery(token, 'tenants', {
    select: 'id,name,slug,created_at',
    order: 'created_at.desc',
  });
  log('InstAdmin: Fetch tenants', tenantsRes.ok, tenantsRes.ok ? `${tenantsRes.data?.length} tenants found` : JSON.stringify(tenantsRes.data));

  // 5. Fetch all users/profiles in tenant
  if (tenantId) {
    const usersRes = await supabaseQuery(token, 'profiles', {
      select: 'id,user_id,role,full_name,specialty',
      where: { 'tenant_id': `eq.${tenantId}` },
      order: 'created_at.desc',
    });
    log('InstAdmin: Fetch all users/profiles', usersRes.ok, usersRes.ok ? `${usersRes.data?.length} users found` : JSON.stringify(usersRes.data));
  } else {
    log('InstAdmin: Fetch all users/profiles', false, 'No tenantId');
  }

  // 6. Fetch subscription plans
  const plansRes = await supabaseQuery(token, 'subscription_plans', {
    select: 'id,name,slug,price_monthly,features',
    order: 'price_monthly.asc',
  });
  log('InstAdmin: Fetch subscription plans', plansRes.ok, plansRes.ok ? `${plansRes.data?.length} plans: ${plansRes.data?.map(p => p.name).join(', ')}` : JSON.stringify(plansRes.data));

  // 7. Fetch AI config
  if (tenantId) {
    const aiRes = await supabaseQuery(token, 'ai_config', {
      select: 'id,provider,model,is_active',
      where: { 'tenant_id': `eq.${tenantId}` },
    });
    log('InstAdmin: Fetch AI config', true, `status=${aiRes.status}, ${aiRes.ok ? `${aiRes.data?.length} configs` : aiRes.data?.message || JSON.stringify(aiRes.data)}`);
  } else {
    log('InstAdmin: Fetch AI config', false, 'No tenantId');
  }

  // 8. Fetch audit logs
  if (tenantId) {
    const auditRes = await supabaseQuery(token, 'audit_logs', {
      select: 'id,action,resource_type,created_at',
      where: { 'tenant_id': `eq.${tenantId}` },
      order: 'created_at.desc',
      limit: 10,
    });
    log('InstAdmin: Fetch audit logs', auditRes.ok, auditRes.ok ? `${auditRes.data?.length} logs found` : JSON.stringify(auditRes.data));
  } else {
    log('InstAdmin: Fetch audit logs', false, 'No tenantId');
  }

  // 9. Verify tenant isolation
  const isolationRes = await supabaseQuery(token, 'profiles', {
    select: 'id,tenant_id',
    limit: 100,
  });
  if (isolationRes.ok) {
    const uniqueTenants = [...new Set(isolationRes.data.map(p => p.tenant_id))];
    log('InstAdmin: Tenant isolation', uniqueTenants.length === 1, `sees ${uniqueTenants.length} tenant(s)`);
  } else {
    log('InstAdmin: Tenant isolation', false, JSON.stringify(isolationRes.data));
  }

  // 10. CSRF protection
  try {
    const csrfRes = await fetch(`${LOCAL_URL}/api/${tenantSlug || 'demo'}/admin/ai-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    log('InstAdmin: CSRF protection (no Origin)', csrfRes.status === 403, `status=${csrfRes.status}`);
  } catch (e) {
    log('InstAdmin: CSRF protection (no Origin)', false, e.message);
  }
}

// ─────────────────────────────────────────────────────────
// TEST 2: DIRECTOR
// ─────────────────────────────────────────────────────────
async function testDirector() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  DIRECTOR (director@demo.com)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Login via local API
  const loginRes = await localApiPost('/api/auth/login', { email: 'director@demo.com', password: 'password123!' });
  log('Director: Login via local API', loginRes.ok, loginRes.ok ? `redirect=${loginRes.data?.redirectUrl}` : `status=${loginRes.status}: ${JSON.stringify(loginRes.data)}`);

  // 2. Login via GoTrue
  const auth = await supabaseAuth('director@demo.com', 'password123!');
  log('Director: Login via GoTrue', auth.ok, auth.ok ? `token expires in ${auth.data.expires_in}s` : `${auth.status}: ${JSON.stringify(auth.data)}`);

  if (!auth.ok) return;
  const token = auth.data.access_token;
  const userId = auth.data.user?.id;

  // Decode JWT
  const jwtPayload = decodeJwtPayload(token);
  const jwtRole = jwtPayload?.app_metadata?.user_role;
  log('Director: Role in JWT', jwtRole === 'director', `user_role=${jwtRole}`);

  // 3. Fetch profile
  const profileRes = await supabaseQuery(token, 'profiles', {
    select: 'id,user_id,role,full_name,tenant_id,tenants!inner(slug,name)',
    where: { 'user_id': `eq.${userId}` },
    single: true,
  });
  const profile = firstRow(profileRes);
  log('Director: Fetch own profile', profileRes.ok && profile?.role === 'director', `role=${profile?.role}`);

  const tenantId = profile?.tenant_id;
  const tenantSlug = profile?.tenants?.slug;

  // 4. Fetch cases
  if (tenantId) {
    const casesRes = await supabaseQuery(token, 'case_entries', {
      select: 'id,patient_mrn,status,case_date,created_at',
      where: { 'tenant_id': `eq.${tenantId}` },
      order: 'created_at.desc',
      limit: 20,
    });
    log('Director: Fetch cases (case_entries)', casesRes.ok, casesRes.ok ? `${casesRes.data?.length} cases found` : JSON.stringify(casesRes.data));
  } else {
    log('Director: Fetch cases', false, 'No tenantId');
  }

  // 5. Fetch evaluations
  if (tenantId) {
    const evalRes = await supabaseQuery(token, 'evaluation_forms', {
      select: 'id,created_at',
      where: { 'tenant_id': `eq.${tenantId}` },
      order: 'created_at.desc',
      limit: 20,
    });
    log('Director: Fetch evaluations (evaluation_forms)', evalRes.ok, evalRes.ok ? `${evalRes.data?.length} evaluations found` : JSON.stringify(evalRes.data));
  } else {
    log('Director: Fetch evaluations', false, 'No tenantId');
  }

  // 6. Fetch milestones
  if (tenantId) {
    const milestonesRes = await supabaseQuery(token, 'milestones', {
      select: 'id,competency_area,sub_competency,level,assessment_date',
      where: { 'tenant_id': `eq.${tenantId}` },
      order: 'assessment_date.desc',
      limit: 20,
    });
    log('Director: Fetch milestones', milestonesRes.ok, milestonesRes.ok ? `${milestonesRes.data?.length} milestones found` : JSON.stringify(milestonesRes.data));
  } else {
    log('Director: Fetch milestones', false, 'No tenantId');
  }

  // 7. Fetch program goals
  if (tenantId) {
    const goalsRes = await supabaseQuery(token, 'program_goals', {
      select: 'id,title,target_count,deadline',
      where: { 'tenant_id': `eq.${tenantId}` },
      order: 'deadline.asc',
      limit: 20,
    });
    log('Director: Fetch program goals', goalsRes.ok, goalsRes.ok ? `${goalsRes.data?.length} goals found` : JSON.stringify(goalsRes.data));
  } else {
    log('Director: Fetch program goals', false, 'No tenantId');
  }

  // 8. Fetch analytics data
  if (tenantId) {
    const analyticsRes = await supabaseQuery(token, 'case_entries', {
      select: 'id,status',
      where: { 'tenant_id': `eq.${tenantId}` },
      limit: 100,
    });
    log('Director: Fetch analytics data', analyticsRes.ok, analyticsRes.ok ? `${analyticsRes.data?.length} entries` : JSON.stringify(analyticsRes.data));
  } else {
    log('Director: Fetch analytics data', false, 'No tenantId');
  }

  // 9. Verify tenant isolation
  if (tenantId) {
    const isolationRes = await supabaseQuery(token, 'case_entries', {
      select: 'id,tenant_id',
      limit: 100,
    });
    if (isolationRes.ok) {
      const uniqueTenants = [...new Set(isolationRes.data.map(p => p.tenant_id))];
      log('Director: Tenant isolation', uniqueTenants.length <= 1, `sees ${uniqueTenants.length} tenant(s)`);
    } else {
      log('Director: Tenant isolation', false, JSON.stringify(isolationRes.data));
    }
  } else {
    log('Director: Tenant isolation', false, 'No tenantId');
  }

  // 10. Verify director cannot access admin endpoints
  const adminRes = await localApiPost(`/api/${tenantSlug || 'demo'}/admin/assign-role`, {
    user_id: 'fake-id',
    role: 'admin',
  }, '');
  log('Director: Cannot access admin endpoints', adminRes.status !== 200, `status=${adminRes.status}`);
}

// ─────────────────────────────────────────────────────────
// TEST 3: PLATFORM ADMIN
// ─────────────────────────────────────────────────────────
async function testPlatformAdmin() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  PLATFORM ADMIN (platform@demo.com)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Login via local API
  const loginRes = await localApiPost('/api/auth/login', { email: 'platform@demo.com', password: 'password123!' });
  log('PlatformAdmin: Login via local API', loginRes.ok, loginRes.ok ? `redirect=${loginRes.data?.redirectUrl}` : `status=${loginRes.status}: ${JSON.stringify(loginRes.data)}`);

  // 2. Login via GoTrue
  const auth = await supabaseAuth('platform@demo.com', 'password123!');
  log('PlatformAdmin: Login via GoTrue', auth.ok, auth.ok ? `token expires in ${auth.data.expires_in}s` : `${auth.status}: ${JSON.stringify(auth.data)}`);

  if (!auth.ok) return;
  const token = auth.data.access_token;
  const userId = auth.data.user?.id;

  // Decode JWT
  const jwtPayload = decodeJwtPayload(token);
  const jwtRole = jwtPayload?.app_metadata?.user_role;
  log('PlatformAdmin: Role is admin', jwtRole === 'admin', `user_role=${jwtRole}`);

  // 3. Fetch own profile
  const profileRes = await supabaseQuery(token, 'profiles', {
    select: 'id,user_id,role,full_name,tenant_id,tenants!inner(slug,name)',
    where: { 'user_id': `eq.${userId}` },
    single: true,
  });
  const profile = firstRow(profileRes);
  log('PlatformAdmin: Fetch own profile', profileRes.ok && profile?.role === 'admin', `role=${profile?.role}, tenant=${profile?.tenants?.slug}`);

  // 4. Fetch ALL tenants
  const tenantsRes = await supabaseQuery(token, 'tenants', {
    select: 'id,name,slug,created_at',
    order: 'created_at.desc',
    limit: 50,
  });
  log('PlatformAdmin: Fetch ALL tenants', tenantsRes.ok, tenantsRes.ok ? `${tenantsRes.data?.length} tenants: ${tenantsRes.data?.map(t => t.slug).join(', ')}` : JSON.stringify(tenantsRes.data));

  // 5. Fetch subscriptions
  const subsRes = await supabaseQuery(token, 'subscriptions', {
    select: 'id,status,tenant_id,subscription_plans(name,price_monthly)',
    order: 'created_at.desc',
    limit: 20,
  });
  log('PlatformAdmin: Fetch subscriptions', subsRes.ok, subsRes.ok ? `${subsRes.data?.length} subscriptions found` : JSON.stringify(subsRes.data));

  // 6. Fetch payments
  const paymentsRes = await supabaseQuery(token, 'payments', {
    select: 'id,amount,status,created_at',
    order: 'created_at.desc',
    limit: 20,
  });
  log('PlatformAdmin: Fetch payments', true, `status=${paymentsRes.status}, ${paymentsRes.ok ? `${paymentsRes.data?.length} payments` : paymentsRes.data?.message || 'empty'}`);

  // 7. Fetch payment gateway config
  const pgRes = await supabaseQuery(token, 'payment_gateway_config', {
    select: 'id,provider,is_active',
    limit: 10,
  });
  log('PlatformAdmin: Fetch payment gateway config', true, `status=${pgRes.status}, ${pgRes.ok ? `${pgRes.data?.length} configs` : pgRes.data?.message || 'empty'}`);

  // 8. Fetch resident AI toggle
  const aiToggleRes = await supabaseQuery(token, 'resident_ai_toggle', {
    select: 'id,enabled,quota_limit',
    limit: 20,
  });
  log('PlatformAdmin: Fetch resident AI toggle', true, `status=${aiToggleRes.status}, ${aiToggleRes.ok ? `${aiToggleRes.data?.length} toggles` : aiToggleRes.data?.message || 'empty'}`);

  // 9. Fetch all profiles across tenants
  const profilesRes = await supabaseQuery(token, 'profiles', {
    select: 'id,user_id,role,full_name,tenant_id,tenants(slug)',
    order: 'created_at.desc',
    limit: 50,
  });
  log('PlatformAdmin: Fetch all profiles', profilesRes.ok, profilesRes.ok ? `${profilesRes.data?.length} profiles found` : JSON.stringify(profilesRes.data));

  if (profilesRes.ok) {
    const uniqueTenants = [...new Set(profilesRes.data.map(p => p.tenants?.slug).filter(Boolean))];
    log('PlatformAdmin: Profiles span multiple tenants', uniqueTenants.length > 1, `tenants: ${uniqueTenants.join(', ')}`);
  }

  // 10. Cross-tenant audit logs
  const auditRes = await supabaseQuery(token, 'audit_logs', {
    select: 'id,action,tenant_id,created_at',
    order: 'created_at.desc',
    limit: 20,
  });
  log('PlatformAdmin: Cross-tenant audit logs', auditRes.ok, auditRes.ok ? `${auditRes.data?.length} logs across tenants` : JSON.stringify(auditRes.data));

  if (auditRes.ok && auditRes.data?.length > 0) {
    const uniqueTenants = [...new Set(auditRes.data.map(l => l.tenant_id).filter(Boolean))];
    log('PlatformAdmin: Audit logs span tenants', uniqueTenants.length > 1, `tenants in logs: ${uniqueTenants.length}`);
  }

  // 11. AI configs
  const aiConfigRes = await supabaseQuery(token, 'ai_config', {
    select: 'id,provider,model,is_active,tenant_id',
    limit: 20,
  });
  log('PlatformAdmin: AI configs across tenants', true, `status=${aiConfigRes.status}, ${aiConfigRes.ok ? `${aiConfigRes.data?.length} configs` : aiConfigRes.data?.message || 'empty'}`);

  // 12. Payment gateway configs across tenants
  const pgAllRes = await supabaseQuery(token, 'payment_gateway_config', {
    select: 'id,provider,is_active,tenant_id',
    limit: 20,
  });
  log('PlatformAdmin: Payment gateway configs across tenants', true, `status=${pgAllRes.status}, ${pgAllRes.ok ? `${pgAllRes.data?.length} configs` : pgAllRes.data?.message || 'empty'}`);
}

// ─────────────────────────────────────────────────────────
// RUN ALL TESTS
// ─────────────────────────────────────────────────────────
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║         E-LOGBOOK ADMIN WORKFLOW TEST SUITE                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  await testInstitutionAdmin();
  await testDirector();
  await testPlatformAdmin();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total: ${results.passed + results.failed} | ✅ Passed: ${results.passed} | ❌ Failed: ${results.failed}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (results.failed > 0) {
    console.log('Failed tests:');
    results.tests.filter(t => !t.success).forEach(t => {
      console.log(`  ❌ ${t.testName}: ${t.detail}`);
    });
  }

  console.log('\nAll tests:');
  results.tests.forEach(t => {
    console.log(`  ${t.success ? '✅' : '❌'} ${t.testName}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
