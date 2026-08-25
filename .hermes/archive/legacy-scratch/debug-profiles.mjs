const SUPABASE_URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function supabaseAuth(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return await res.json();
}

async function supabaseQuery(token, table, options = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = [];
  if (options.select) params.push(`select=${options.select}`);
  if (options.where) {
    for (const [k, v] of Object.entries(options.where)) {
      params.push(`${k}=${v}`);
    }
  }
  if (options.order) params.push(`order=${options.order}`);
  if (options.limit) params.push(`limit=${options.limit}`);
  if (options.single) params.push('limit=1');
  if (params.length) url += '?' + params.join('&');

  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const email = 'admin@demo.com';
  const auth = await supabaseAuth(email, 'password123!');
  const token = auth.access_token;
  const userId = auth.user.id;

  console.log('userId:', userId);

  // Try different query approaches
  console.log('\n1. Query with user_id=eq...');
  const r1 = await supabaseQuery(token, 'profiles', {
    select: '*',
    where: { 'user_id': `eq.${userId}` },
    single: true,
  });
  console.log('Result:', r1.status, JSON.stringify(r1.data));

  console.log('\n2. Query all profiles with limit...');
  const r2 = await supabaseQuery(token, 'profiles', {
    select: 'id,user_id,role,full_name,tenant_id',
    limit: 5,
  });
  console.log('Result:', r2.status, JSON.stringify(r2.data));

  console.log('\n3. Query tenants...');
  const r3 = await supabaseQuery(token, 'tenants', {
    select: 'id,name,slug',
    limit: 5,
  });
  console.log('Result:', r3.status, JSON.stringify(r3.data));
}

main();
