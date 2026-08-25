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

function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1];
    const padded = base64.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch { return null; }
}

async function main() {
  const accounts = ['admin@demo.com', 'director@demo.com', 'platform@demo.com'];
  
  for (const email of accounts) {
    const auth = await supabaseAuth(email, 'password123!');
    if (!auth.access_token) {
      console.log(`${email}: LOGIN FAILED - ${JSON.stringify(auth)}`);
      continue;
    }
    
    const jwt = decodeJwtPayload(auth.access_token);
    console.log(`\n=== ${email} ===`);
    console.log('user.id:', auth.user?.id);
    console.log('app_metadata (from response):', JSON.stringify(auth.app_metadata));
    console.log('JWT payload.app_metadata:', JSON.stringify(jwt?.app_metadata));
    console.log('JWT payload.user_metadata:', JSON.stringify(jwt?.user_metadata));
    console.log('JWT payload.sub:', jwt?.sub);
  }
}

main();
