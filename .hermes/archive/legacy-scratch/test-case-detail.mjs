const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'resident@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Check if the case exists
  const caseId = 'f59686fc-cfcb-4b2f-9ad8-bddb679f31fe';
  const res = await fetch(`${URL_BASE}/rest/v1/case_entries?id=eq.${caseId}&select=*,case_templates(name,specialty,fields),profiles!case_entries_resident_id_fkey(full_name),tenants(tenant_type)`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const data = await res.json();
  console.log('Case query result:', res.status);
  console.log('Data:', JSON.stringify(data, null, 2));
}

test().catch(e => console.error('Error:', e));
