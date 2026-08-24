import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const uid = 'f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783';
const upd = await fetch(URL+'/auth/v1/admin/users/'+uid,{method:'PUT',headers:{apikey:SRK,Authorization:'Bearer '+SRK,'Content-Type':'application/json'},body:JSON.stringify({password:'password123!'})}).then(r=>r.json());
console.log('update:', upd.id?'OK':JSON.stringify(upd).slice(0,200));
await new Promise(r=>setTimeout(r,3000));
const t = await fetch(URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY},body:JSON.stringify({email:'resident@demo.com',password:'password123!'})}).then(r=>r.json());
console.log('resident login:', t.access_token?'RESTORED':JSON.stringify(t).slice(0,160));
