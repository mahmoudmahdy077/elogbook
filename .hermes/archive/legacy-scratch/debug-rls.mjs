const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  // Login as resident
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const auth = await login.json();
  const access_token = auth.access_token;
  const user_id = auth.user.id;
  console.log('User ID:', user_id);
  
  // Get profile
  const profileRes = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,tenant_id,role&user_id=eq.${user_id}`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const profiles = await profileRes.json();
  console.log('Profile:', JSON.stringify(profiles[0]));
  
  // Get a draft case
  const casesRes = await fetch(`${URL_BASE}/rest/v1/case_entries?select=id,status,resident_id,tenant_id&status=eq.draft&limit=1`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const cases = await casesRes.json();
  console.log('Draft case:', JSON.stringify(cases[0]));
  
  if (cases[0]) {
    // Check if resident_id matches profile id
    console.log('resident_id match:', cases[0].resident_id === profiles[0].id);
    console.log('tenant_id match:', cases[0].tenant_id === profiles[0].tenant_id);
    
    // Try a simple update (just changing a non-status field)
    const updateRes = await fetch(`${URL_BASE}/rest/v1/case_entries?id=eq.${cases[0].id}`, {
      method: 'PATCH',
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ field_values: JSON.stringify({ test: 'value' }) })
    });
    const updateData = await updateRes.json();
    console.log('Simple update result:', updateRes.status, JSON.stringify(updateData));
    
    // Now try to change status
    const statusRes = await fetch(`${URL_BASE}/rest/v1/case_entries?id=eq.${cases[0].id}`, {
      method: 'PATCH',
      headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify({ status: 'pending' })
    });
    const statusData = await statusRes.json();
    console.log('Status update result:', statusRes.status, JSON.stringify(statusData));
  }
}

test().catch(e => console.error('Error:', e));
