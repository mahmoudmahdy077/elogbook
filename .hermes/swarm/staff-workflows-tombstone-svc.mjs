// Authorized disposable-test environment variables: SUPABASE_URL, SUPABASE_ANON_KEY,
// and SUPABASE_SERVICE_ROLE_KEY.
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const BASE = requiredEnv('SUPABASE_URL');
requiredEnv('SUPABASE_ANON_KEY');
const SERVICE = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const now = new Date().toISOString();
(async () => {
  for (const id of ['df2496a4-207a-4991-ac03-55676c9e4219', 'c5230a8b-ea0c-464e-87da-e53eec66d7bf']) {
    const r = await fetch(`${BASE}/rest/v1/case_entries?id=eq.${id}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ deleted_at: now }),
    });
    const j = await r.json();
    console.log(id.slice(0, 8), 'http=' + r.status, JSON.stringify(j?.[0] ? { status: j[0].status, deleted_at: j[0].deleted_at } : j));
  }
  const v = await fetch(`${BASE}/rest/v1/case_entries?id=in.(df2496a4-207a-4991-ac03-55676c9e4219,c5230a8b-ea0c-464e-87da-e53eec66d7bf)&select=id,status,deleted_at`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  console.log('FINAL:', JSON.stringify(await v.json()));
})();
