const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Check templates
  const templatesRes = await fetch(`${URL_BASE}/rest/v1/case_templates?select=id,name,specialty`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const templates = await templatesRes.json();
  console.log('Templates:', templates);
  
  // Check profiles
  const profilesRes = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,user_id,role,full_name`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const profiles = await profilesRes.json();
  console.log('\nProfiles:', profiles);
  
  // Try to create a case with the first template
  if (templates.length > 0 && profiles.length > 0) {
    const template = templates[0];
    const profile = profiles[0];
    console.log('\nTrying to create case with:');
    console.log('  Template ID:', template.id);
    console.log('  Resident ID:', profile.id);
    
    const createRes = await fetch(`${URL_BASE}/rest/v1/case_entries`, {
      method: 'POST',
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({
        tenant_id: '9cd50d60-febe-4adf-be0f-a36bf82762f6',
        resident_id: profile.id,
        template_id: template.id,
        patient_mrn: null,
        patient_dob: null,
        patient_age_years: 30,
        patient_hash: 'test',
        case_date: new Date().toISOString().split('T')[0],
        field_values: JSON.stringify({ procedure_name: 'Test Case' }),
        status: 'approved',
        is_deidentified: true,
      })
    });
    const data = await createRes.json();
    console.log('\nCreate result:', createRes.status);
    if (createRes.status === 201) {
      console.log('SUCCESS: Case created with status:', data[0].status);
      // Cleanup
      await fetch(`${URL_BASE}/rest/v1/case_entries?id=eq.${data[0].id}`, {
        method: 'DELETE',
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
      });
    } else {
      console.log('Error:', JSON.stringify(data, null, 2));
    }
  }
}

test();
