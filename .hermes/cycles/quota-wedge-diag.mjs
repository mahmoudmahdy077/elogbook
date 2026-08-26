// Diagnose the quota wedge: what's counted, what's deleted, what does the counter say?
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new globalThis.URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json' };
const T = '9cd50d60-febe-4adf-be0f-a36bf82762f6';

// service-role reads (bypass RLS)
const cnt = async (q) => {
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { ...H, Prefer: 'count=exact' } });
  return Number(r.headers.get('content-range')?.split('/')[1]);
};
console.log('active (deleted_at null):', await cnt(`case_entries?tenant_id=eq.${T}&deleted_at=is.null&select=id`));
console.log('tombstoned:', await cnt(`case_entries?tenant_id=eq.${T}&deleted_at=not.is.null&select=id`));
console.log('active status=draft:', await cnt(`case_entries?tenant_id=eq.${T}&status=eq.draft&deleted_at=is.null&select=id`));
console.log('active status=approved:', await cnt(`case_entries?tenant_id=eq.${T}&status=eq.approved&deleted_at=is.null&select=id`));
console.log('active status=pending:', await cnt(`case_entries?tenant_id=eq.${T}&status=eq.pending&deleted_at=is.null&select=id`));

const t = await fetch(`${SB}/rest/v1/tenants?id=eq.${T}&select=*`, { headers: H }).then(r => r.json());
const row = t[0] || {};
for (const k of Object.keys(row)) {
  if (/quota|case|count|period|plan/i.test(k)) console.log('tenant.' + k, '=', JSON.stringify(row[k]).slice(0, 120));
}
