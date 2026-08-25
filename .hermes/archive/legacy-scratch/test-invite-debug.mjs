const URL_BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';

async function test() {
  const login = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.com', password: 'password123!' })
  });
  const auth = await login.json();
  const token = auth.access_token;

  // Check admin's tenant_id
  const profileRes = await fetch(`${URL_BASE}/rest/v1/profiles?select=id,tenant_id,role&user_id=eq.${auth.user.id}`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}` }
  });
  const profile = await profileRes.json();
  console.log('Admin profile:', profile[0]);

  // Check what tenant_id get_tenant_id() returns
  const jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  console.log('\nJWT tenant_id:', jwt.app_metadata?.tenant_id);
  console.log('JWT user_role:', jwt.app_metadata?.user_role);

  // Try to insert with the correct tenant_id
  const inviteRes = await fetch(`${URL_BASE}/rest/v1/tenant_invites`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({
      tenant_id: profile[0].tenant_id,
      email: 'test-invite2@example.com',
      invited_by: auth.user.id,
      role: 'resident',
      status: 'pending',
    })
  });
  const invite = await inviteRes.json();
  console.log('\nCreate invite:', inviteRes.status);
  if (inviteRes.status === 201) {
    console.log('   Invite created:', invite[0]?.id);
  } else {
    console.log('   Error:', JSON.stringify(invite));
  }
}

test();
