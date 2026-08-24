// verify demo account login health
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
for (const em of ['resident@demo.com','supervisor@demo.com','director@demo.com','admin@demo.com','platform@demo.com']) {
  const t = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:em,password:'password123!'})}).then(r=>r.json());
  console.log(em+':', t.access_token?'OK':'FAIL '+JSON.stringify(t).slice(0,140));
}
