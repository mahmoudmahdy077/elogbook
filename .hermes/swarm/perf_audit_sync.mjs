import { writeFileSync } from "node:fs";

const SUPABASE_URL = "https://nuyedxkzaimlzaetbpaw.supabase.co";
const ANON_KEY = "sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3";
const TENANT_ID = "9cd50d60-febe-4adf-be0f-a36bf82762f6";
const rest = SUPABASE_URL + "/rest/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

await sleep(3000);
let token, userId;
{
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "resident@demo.com", password: "password123!" }),
  });
  const sess = await res.json();
  token = sess.access_token; userId = sess.user.id;
}
const H = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const profileId = (await j(await fetch(`${rest}/profiles?user_id=eq.${userId}&select=id`, { headers: H })))[0].id;
console.log("profile:", profileId);

const rpcSync = (rows) => fetch(`${rest}/rpc/sync_push_batch`, {
  method: "POST", headers: H, body: JSON.stringify({ p_table_name: "case_entries", p_rows: rows }),
});
const makeRow = () => ({
  id: crypto.randomUUID(),
  tenant_id: TENANT_ID,
  resident_id: profileId,
  template_id: "00000000-0000-4000-8000-000000000010",
  patient_mrn: "PERF-AUDIT-TOMBSTONE",
  patient_dob: "1990-01-01",
  case_date: new Date().toISOString().slice(0, 10),
  field_values: {},
  status: "draft",
  is_deidentified: false,
});
const quota = async () => (await j(await fetch(`${rest}/rpc/check_case_quota`, {
  method: "POST", headers: H, body: JSON.stringify({ p_tenant_id: TENANT_ID }),
})))[0];

// adopt any stray undeleted PERF-AUDIT rows first
const owned = [];
{
  const stray = await j(await fetch(`${rest}/case_entries?patient_mrn=eq.PERF-AUDIT-TOMBSTONE&deleted_at=is.null&select=id`, { headers: H }));
  if (Array.isArray(stray)) {
    const tr = await stray.map((r) => ({ id: r.id, tenant_id: TENANT_ID, deleted_at: new Date().toISOString() }));
    const resp = await rpcSync(tr);
    console.log("tombstoned strays:", resp.status);
  }
}

// gather existing tombstoned audit rows
{
  const ex = await j(await fetch(`${rest}/case_entries?patient_mrn=eq.PERF-AUDIT-TOMBSTONE&deleted_at=not.is.null&select=id`, { headers: H }));
  if (Array.isArray(ex)) owned.push(...ex.map((r) => r.id));
}
console.log("existing audit rows:", owned.length);

// phase 1: create rows up to 10 total, respecting quota (insert -> immediate tombstone)
while (owned.length < 10) {
  const q = await quota();
  const headroom = q.max_cases - q.current_count;
  if (headroom <= 0) { console.error("NO QUOTA HEADROOM, owned=", owned.length); process.exit(1); }
  const n = Math.min(headroom, 10 - owned.length);
  const batch = Array.from({ length: n }, makeRow);
  const r1 = await rpcSync(batch);
  if (!r1.ok) { console.error("insert failed:", r1.status, await j(r1)); process.exit(1); }
  console.log(`inserted ${n}, quota now:`, JSON.stringify(await quota()));
  // verify visibility
  const vis = await j(await fetch(`${rest}/case_entries?id=in.(${batch.map((b) => b.id).join(",")})&select=id`, { headers: H }));
  if (!Array.isArray(vis) || vis.length !== n) { console.error("visibility mismatch", JSON.stringify(vis)); process.exit(1); }
  owned.push(...batch.map((b) => b.id));
  // tombstone immediately to free quota
  const tr = batch.map((b) => ({ id: b.id, tenant_id: TENANT_ID, deleted_at: new Date().toISOString() }));
  const r2 = await rpcSync(tr);
  if (!r2.ok) { console.error("tombstone failed:", r2.status, await j(r2)); process.exit(1); }
  console.log(`tombstoned ${n}; owned=${owned.length}`);
}

// probe: can we update-path an already-tombstoned draft row?
{
  const probe = [{ id: owned[0], tenant_id: TENANT_ID, field_values: {} }];
  const r = await rpcSync(probe);
  console.log("update-path probe on tombstoned draft:", r.status, r.ok ? "" : JSON.stringify(await j(r)));
  if (!r.ok) process.exit(1);
}

// phase 2: timed 5x sync_push_batch with 10-row batches (update path)
console.log("== sync_push_batch_10rows (update path) ==");
const results = { timestamp: new Date().toISOString(), sections: {}, mode: "update-path 10-row batches on tombstoned draft rows" };
const samples = [];
for (let i = 0; i < 5; i++) {
  if (i > 0) await sleep(250);
  const rows = owned.slice(0, 10).map((id) => ({ id, tenant_id: TENANT_ID, field_values: {} }));
  const t0 = performance.now();
  let status = null;
  try {
    const r = await rpcSync(rows);
    status = r.status;
    await r.text();
    samples.push({ ms: performance.now() - t0, status, ok: r.ok });
  } catch (e) {
    samples.push({ ms: performance.now() - t0, status, ok: false, err: String(e) });
  }
  console.log(`sync batch ${i + 1}: ${samples[i].ms.toFixed(0)}ms status=${status}`);
}
const s = samples.map((x) => x.ms).sort((a, b) => a - b);
results.sections.sync_push_batch_10rows = {
  n: s.length,
  p50: +s[Math.ceil(0.5 * s.length) - 1].toFixed(1),
  p95: +s[Math.ceil(0.95 * s.length) - 1].toFixed(1),
  min: +s[0].toFixed(1),
  max: +s[s.length - 1].toFixed(1),
  statuses: samples.map((x) => x.status),
  errors: samples.filter((x) => !x.ok).length,
};

// final verification: all owned rows tombstoned
await sleep(250);
const fin = await j(await fetch(`${rest}/case_entries?patient_mrn=eq.PERF-AUDIT-TOMBSTONE&select=id,deleted_at`, { headers: H }));
const alive = Array.isArray(fin) ? fin.filter((r) => !r.deleted_at) : [];
results.total_audit_rows = Array.isArray(fin) ? fin.length : fin;
results.undeleted_remaining = alive.length;
results.audit_row_ids = Array.isArray(fin) ? fin.map((r) => r.id) : [];
console.log(`final check: ${results.total_audit_rows} audit rows, undeleted remaining=${alive.length}`);

writeFileSync(new URL("./perf_results_sync.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("DONE");
