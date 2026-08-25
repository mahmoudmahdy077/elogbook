const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Check all cases
  const casesRes = await fetch(`${URL_BASE}/rest/v1/case_entries?select=id,template_id,resident_id,status,patient_mrn,field_values&limit=20`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const cases = await casesRes.json();
  
  console.log('Total cases:', cases.length);
  console.log('\nChecking for invalid data...');
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  for (const c of cases) {
    const issues = [];
    if (!c.template_id || !uuidRegex.test(c.template_id)) {
      issues.push(`template_id: ${c.template_id}`);
    }
    if (!c.resident_id || !uuidRegex.test(c.resident_id)) {
      issues.push(`resident_id: ${c.resident_id}`);
    }
    if (!c.patient_mrn && !c.patient_hash) {
      issues.push('No patient data');
    }
    
    if (issues.length > 0) {
      console.log(`\nCase ${c.id}:`);
      console.log('  Status:', c.status);
      console.log('  Issues:', issues.join(', '));
      console.log('  Field values:', c.field_values);
    }
  }
  
  console.log('\nAll cases checked.');
}

test();
