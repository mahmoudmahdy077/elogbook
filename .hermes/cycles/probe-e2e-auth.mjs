// Reproduce the e2e auth seed against the live dev server (no browser)
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref = URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? '';

const s = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
console.log('login ok:', !!s.access_token);

const tokenValue = JSON.stringify({
  access_token: s.access_token,
  refresh_token: s.refresh_token,
  expires_in: s.expires_in ?? 3600,
  expires_at: s.expires_at ?? Math.floor(Date.now()/1000)+3600,
  token_type: 'bearer',
  user: s.user,
});
const cookie = `sb-${ref}-auth-token=` + encodeURIComponent('base64-' + Buffer.from(tokenValue).toString('base64'));

const r = await fetch('http://localhost:3000/demo/dashboard', { headers: { Cookie: cookie }, redirect: 'manual' });
console.log('/demo/dashboard:', r.status, r.headers.get('location') ?? '');

// also try raw base64 (not uri-encoded)
const cookie2 = `sb-${ref}-auth-token=` + 'base64-' + Buffer.from(tokenValue).toString('base64');
const r2 = await fetch('http://localhost:3000/demo/dashboard', { headers: { Cookie: cookie2 }, redirect: 'manual' });
console.log('(raw base64):', r2.status, r2.headers.get('location') ?? '');
