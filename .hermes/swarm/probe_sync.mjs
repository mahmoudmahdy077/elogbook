const SUPABASE_URL = "https://nuyedxkzaimlzaetbpaw.supabase.co";
const ANON_KEY = "sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3";
const TENANT_ID = "9cd50d60-febe-4adf-be0f-a36bf82762f6";
const rest = SUPABASE_URL + "/rest/v1";

await new Promise((r) => setTimeout(r, 3000));
let token, userId;
{
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "resident@demo.com", password: "password123!" }),
  });
  const sess = await res.json();
  token = sess.access_token;
  userId = sess.user.id;
}
const H = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const profArr = await (await fetch(`${rest}/profiles?user_id=eq.${userId}&select=id`, { headers: H })).json();
const profileId = profArr[0].id;

// find existing tombstoned audit rows to reuse ids (update path) instead of inserting new
const exist = await (await fetch(`${rest}/case_entries?patient_mrn=eq.PERF-AUDIT-TOMBSTONE&select=id,deleted_at&limit=30`, { headers: H })).json();
console.log("existing audit rows:", JSON.stringify(exist));

// try a fresh 10-row batch and print error
const templateId = "00000000-0000-4000-8000-000000000010";
const rows = [];
for (let i = 0; i < 10; i++) {
  rows.push({
    id: crypto.randomUUID(),
    tenant_id: TENANT_ID,
    resident_id: profileId,
    template_id: templateId,
    patient_mrn: "PERF-AUDIT-TOMBSTONE",
    patient_dob: "1990-01-01",
    case_date: new Date().toISOString().slice(0, 10),
    field_values: {},
    status: "draft",
    is_deidentified: false,
  });
}
const r = await fetch(`${rest}/rpc/sync_push_batch`, {
  method: "POST", headers: H,
  body: JSON.stringify({ p_table_name: "case_entries", p_rows: rows }),
});
console.log("batch status:", r.status);
console.log("batch body:", await r.text());

// quota info
const q = await fetch(`${rest}/rpc/check_case_quota`, {
  method: "POST", headers: H, body: JSON.stringify({ p_tenant_id: TENANT_ID }),
});
console.log("quota:", q.status, await q.text());
