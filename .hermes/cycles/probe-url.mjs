import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const u = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
console.log('host:', new globalThis.URL(u).host);
const ref = u.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? '';
console.log('parsed PROJECT_REF:', JSON.stringify(ref));
