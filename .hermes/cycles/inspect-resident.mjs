import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

const list = await fetch(`${URL}/auth/v1/admin/users?email=resident@demo.com`,{headers:{apikey:SRK,Authorization:`Bearer ${SRK}`}}).then(r=>r.json());
for (const u of (list?.users ?? [])) {
  console.log(JSON.stringify({id:u.id,email:u.email,banned_until:u.banned_until,email_confirmed_at:u.email_confirmed_at,confirmation_sent_at:u.confirmation_sent_at,last_sign_in_at:u.last_sign_in_at,updated_at:u.updated_at,role:u.role},null,1));
}
await new Promise(r=>setTimeout(r,5000));
const t = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
console.log('retry login:', t.access_token ? 'RESTORED' : JSON.stringify(t).slice(0,160));
