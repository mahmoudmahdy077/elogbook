import { writeFileSync } from "node:fs";

const SUPABASE_URL = "https://nuyedxkzaimlzaetbpaw.supabase.co";
const ANON_KEY = "sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3";
const TENANT_ID = "9cd50d60-febe-4adf-be0f-a36bf82762f6";
const EMAIL = "resident@demo.com";
const PASSWORD = "password123!";
const rest = SUPABASE_URL + "/rest/v1";

const results = { timestamp: new Date().toISOString(), sections: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

async function timed(fn) {
  const t0 = now();
  try {
    const r = await fn();
    const buf = await r.arrayBuffer();
    return { ms: now() - t0, status: r.status, ok: r.ok, bytes: buf.byteLength };
  } catch (e) {
    return { ms: now() - t0, status: null, ok: false, err: String(e).slice(0, 200) };
  }
}

function stats(samples) {
  const s = samples.map((x) => x.ms).sort((a, b) => a - b);
  return {
    n: s.length,
    p50: +s[Math.ceil(0.5 * s.length) - 1].toFixed(1),
    p95: +s[Math.ceil(0.95 * s.length) - 1].toFixed(1),
    min: +s[0].toFixed(1),
    max: +s[s.length - 1].toFixed(1),
    statuses: samples.map((x) => x.status),
    errors: samples.filter((x) => !x.ok).length,
  };
}

async function bench(name, makeReq, iterations = 5) {
  console.log(`== ${name} ==`);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t = await timed(makeReq);
    samples.push(t);
    console.log(`${name} ${i + 1}: ${t.ms.toFixed(0)}ms status=${t.status}`);
    await sleep(250);
  }
  results.sections[name] = stats(samples);
}

// login (paced)
await sleep(3000);
let token, userId;
{
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) { console.error("FATAL auth", res.status); process.exit(1); }
  const sess = await res.json();
  token = sess.access_token;
  userId = sess.user.id;
}
const H = { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

// evaluations list (faculty_evaluations, correct columns)
await bench("evaluations_list_faculty", () =>
  fetch(`${rest}/faculty_evaluations?select=id,evaluation_date,created_at&order=created_at.desc&limit=20`, { headers: H })
);

// sync_push_batch 10-row batch
console.log("== sync_push_batch_10rows ==");
const templateId = "00000000-0000-4000-8000-000000000010";
const ids = [];
const rows = [];
for (let i = 0; i < 10; i++) {
  const id = crypto.randomUUID();
  ids.push(id);
  rows.push({
    id,
    tenant_id: TENANT_ID,
    resident_id: userId,
    template_id: templateId,
    patient_mrn: "PERF-AUDIT-TOMBSTONE",
    patient_dob: "1990-01-01",
    case_date: new Date().toISOString().slice(0, 10),
    field_values: {},
    status: "draft",
    is_deidentified: false,
  });
}
const makeBatchReq = () =>
  fetch(`${rest}/rpc/sync_push_batch`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ p_table_name: "case_entries", p_rows: rows }),
  });

const first = await timed(makeBatchReq);
console.log(`sync batch 1 (insert path): ${first.ms.toFixed(0)}ms status=${first.status}`);
if (!first.ok) {
  const dbg = await fetch(`${rest}/rpc/sync_push_batch`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ p_table_name: "case_entries", p_rows: [rows[0]] }),
  });
  console.log("diag:", dbg.status, (await dbg.text()).slice(0, 300));
}
const samples = [first];
for (let i = 1; i < 5; i++) {
  await sleep(250);
  const t = await timed(makeBatchReq);
  samples.push(t);
  console.log(`sync batch ${i + 1} (update path): ${t.ms.toFixed(0)}ms status=${t.status}`);
}
results.sections.sync_push_batch_10rows = stats(samples);

// verify created rows, then tombstone ALL of them
{
  const v = await fetch(`${rest}/case_entries?id=in.(${ids.join(",")})&select=id`, { headers: H });
  const arr = await v.json();
  results.created_rows_visible = Array.isArray(arr) ? arr.length : String(arr).slice(0, 200);

  const tombRows = ids.map((id) => ({ id, tenant_id: TENANT_ID, deleted_at: new Date().toISOString() }));
  const tb = await timed(() =>
    fetch(`${rest}/rpc/sync_push_batch`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ p_table_name: "case_entries", p_rows: tombRows }),
    })
  );
  console.log(`tombstone batch: status=${tb.status} in ${tb.ms.toFixed(0)}ms`);
  results.tombstone_status = tb.status;

  await sleep(250);
  const v2 = await fetch(`${rest}/case_entries?id=in.(${ids.join(",")})&select=id&deleted_at=not.is.null`, { headers: H });
  const arr2 = await v2.json();
  results.tombstoned_rows_verified = Array.isArray(arr2) ? arr2.length : String(arr2).slice(0, 200);
  console.log(`tombstoned verified: ${results.tombstoned_rows_verified}/${ids.length}`);

  // safety sweep: any PERF-AUDIT rows left undeleted from earlier attempts?
  const sweep = await fetch(`${rest}/case_entries?patient_mrn=eq.PERF-AUDIT-TOMBSTONE&deleted_at=is.null&select=id`, { headers: H });
  const sarr = await sweep.json();
  if (Array.isArray(sarr) && sarr.length > 0) {
    const staleIds = sarr.map((r) => r.id);
    await fetch(`${rest}/rpc/sync_push_batch`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        p_table_name: "case_entries",
        p_rows: staleIds.map((id) => ({ id, tenant_id: TENANT_ID, deleted_at: new Date().toISOString() })),
      }),
    });
    console.log(`swept ${staleIds.length} stale rows`);
    results.stale_rows_swept = staleIds.length;
  }
  results.created_row_ids = ids;
}

writeFileSync(new URL("./perf_results_extra2.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("DONE");
