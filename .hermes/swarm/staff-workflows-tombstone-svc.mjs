const BASE = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWVkeGt6YWltbHphZXRicGF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDQ3OTI1OSwiZXhwIjoyMDk2MDU1MjU5fQ.wfTneCBjYGfSvmo-GGTSEBv3JwkbSl8QByWR__WVpJg';
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
