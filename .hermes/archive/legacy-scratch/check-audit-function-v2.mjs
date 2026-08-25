const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();

  // Check pg_proc for audit_table_change
  const funcRes = await fetch(`${URL_BASE}/rest/v1/pg_proc?select=proname,prosrc&proname=eq.audit_table_change`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  console.log('Function check:', funcRes.status);
  if (funcRes.ok) {
    const data = await funcRes.json();
    console.log('Function source (first 500 chars):', data[0]?.prosrc?.substring(0, 500));
  }
}

test();
