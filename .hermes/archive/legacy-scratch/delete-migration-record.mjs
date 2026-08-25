const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'platform@demo.com', password: 'password123!' })
  });
  const { access_token } = await login.json();

  // Delete the failed migration record
  const delRes = await fetch(`${URL_BASE}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260818130000'" })
  });
  console.log('Delete migration record:', delRes.status, await delRes.text());
}

test();
