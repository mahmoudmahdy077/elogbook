const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Try to enable pgcrypto extension
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "CREATE EXTENSION IF NOT EXISTS pgcrypto" })
  });
  console.log('Enable pgcrypto result:', res.status);
  const data = await res.json();
  console.log('Data:', data);
  
  // Check if digest function exists
  const res2 = await fetch(`${URL_BASE}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "SELECT digest('test', 'sha256')" })
  });
  console.log('Test digest result:', res2.status);
  const data2 = await res2.json();
  console.log('Data:', data2);
}

test().catch(e => console.error('Error:', e));
