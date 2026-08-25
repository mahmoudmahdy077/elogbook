const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Check case_entries columns
  const res = await fetch(`${URL_BASE}/rest/v1/case_entries?select=*&limit=1`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const data = await res.json();
  if (data.length > 0) {
    console.log('Case entry columns:', Object.keys(data[0]));
    console.log('Has resident_id:', 'resident_id' in data[0]);
  }
  
  // Check templates
  const templatesRes = await fetch(`${URL_BASE}/rest/v1/case_templates?select=id,name,tenant_id`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const templates = await templatesRes.json();
  console.log('\nAvailable templates:', templates.length);
  templates.forEach(t => console.log(`  - ${t.name} (tenant: ${t.tenant_id})`));
  
  // Try to create a case with a template
  if (templates.length > 0) {
    const template = templates[0];
    console.log('\nTrying to create case with template:', template.id, template.name);
    
    const profileRes = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,tenant_id&limit=1`, {
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
    });
    const profiles = await profileRes.json();
    const profile = profiles[0];
    
    const insertData = {
      tenant_id: profile.tenant_id,
      resident_id: profile.id,
      template_id: template.id,
      patient_mrn: 'TEST-UUID-' + Date.now(),
      patient_dob: '1990-01-01',
      case_date: new Date().toISOString().split('T')[0],
      field_values: JSON.stringify({ procedure_name: 'Test' }),
      status: 'draft',
      is_deidentified: false,
    };
    
    const insertRes = await fetch(`${URL_BASE}/rest/v1/case_entries`, {
      method: 'POST',
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(insertData)
    });
    const insertData2 = await insertRes.json();
    console.log('Insert result:', insertRes.status);
    if (insertRes.status !== 201) {
      console.log('Error:', JSON.stringify(insertData2));
    } else {
      console.log('Case created successfully:', insertData2[0]?.id);
      // Clean up
      await fetch(`${URL_BASE}/rest/v1/case_entries?id=eq.${insertData2[0].id}`, {
        method: 'DELETE',
        headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
      });
      console.log('Cleaned up test case');
    }
  }
}

test().catch(e => console.error('Error:', e));
