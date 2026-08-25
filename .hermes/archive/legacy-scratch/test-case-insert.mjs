const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Test hash_patient_mrn RPC
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/hash_patient_mrn`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_mrn: 'TEST-MRN', p_tenant_id: '9cd50d60-febe-4adf-be0f-a36bf82762f6' })
  });
  console.log('hash_patient_mrn result:', res.status);
  const data = await res.json();
  console.log('Data:', data);
  
  // Test case insert with all required fields
  const profileRes = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,tenant_id&limit=1`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const profiles = await profileRes.json();
  const profile = profiles[0];
  
  const insertData = {
    tenant_id: profile.tenant_id,
    resident_id: profile.id,
    template_id: '00000000-0000-0000-0000-000000000010',
    patient_mrn: null,
    patient_dob: null,
    patient_age_years: 35,
    patient_hash: data || '',
    case_date: new Date().toISOString().split('T')[0],
    field_values: JSON.stringify({ procedure_name: 'Test Appendectomy', anesthesia_type: 'General', supervision_level: 'Performed Under Supervision' }),
    status: 'draft',
    is_deidentified: true,
  };
  
  console.log('\nInsert data:', JSON.stringify(insertData, null, 2));
  
  const insertRes = await fetch(`${URL_BASE}/rest/v1/case_entries`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(insertData)
  });
  const insertResult = await insertRes.json();
  console.log('\nInsert result:', insertRes.status);
  if (insertRes.status !== 201) {
    console.log('Error:', JSON.stringify(insertResult));
  } else {
    console.log('Case created successfully:', insertResult[0]?.id);
    // Clean up
    await fetch(`${URL_BASE}/rest/v1/case_entries?id=eq.${insertResult[0].id}`, {
      method: 'DELETE',
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
    });
    console.log('Cleaned up test case');
  }
}

test().catch(e => console.error('Error:', e));
