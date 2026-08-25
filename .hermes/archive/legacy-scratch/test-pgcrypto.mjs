const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Test if pgcrypto is enabled by calling digest directly
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/hash_patient_mrn`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_mrn: 'TEST', p_tenant_id: '9cd50d60-febe-4adf-be0f-a36bf82762f6' })
  });
  console.log('hash_patient_mrn result:', res.status);
  const data = await res.json();
  console.log('Data:', data);
}

test().catch(e => console.error('Error:', e));
