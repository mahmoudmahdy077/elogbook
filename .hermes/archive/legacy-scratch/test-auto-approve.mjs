const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Create a case with approved status
  const res = await fetch(`${URL_BASE}/rest/v1/case_entries`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      tenant_id: '9cd50d60-febe-4adf-be0f-a36bf82762f6',
      resident_id: '2ce0152b-e6da-43c9-8797-641bbbf5187d',
      template_id: '00000000-0000-0000-0000-000000000010',
      patient_mrn: null,
      patient_dob: null,
      patient_age_years: 25,
      patient_hash: 'test',
      case_date: new Date().toISOString().split('T')[0],
      field_values: JSON.stringify({ procedure_name: 'Test Auto-Approve Case' }),
      status: 'approved',
      is_deidentified: true,
    })
  });
  const data = await res.json();
  console.log('Create result:', res.status);
  if (res.status === 201) {
    console.log('Case created with status:', data[0].status);
    console.log('Case ID:', data[0].id);
    console.log('TEST PASSED: Case auto-approved!');
    
    // Cleanup
    await fetch(`${URL_BASE}/rest/v1/case_entries?id=eq.${data[0].id}`, {
      method: 'DELETE',
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
    });
    console.log('Cleaned up test case');
  } else {
    console.log('Error:', data);
  }
}
test();
