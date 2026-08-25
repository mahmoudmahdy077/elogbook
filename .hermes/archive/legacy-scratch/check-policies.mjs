const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  // Login as platform admin (has full access)
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();
  
  // Check pg_policies for case_entries
  const res = await fetch(`${URL_BASE}/rest/v1/pg_policies?select=policyname,cmd,qual,with_check&tablename=eq.case_entries`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}` }
  });
  const policies = await res.json();
  console.log('case_entries policies:', JSON.stringify(policies, null, 2));
}

test().catch(e => console.error('Error:', e));
