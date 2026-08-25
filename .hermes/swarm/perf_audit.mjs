import { writeFileSync } from "node:fs";

const SUPABASE_URL = "https://nuyedxkzaimlzaetbpaw.supabase.co";
const ANON_KEY = "sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3";
const TENANT_ID = "9cd50d60-febe-4adf-be0f-a36bf82762f6";
const EMAIL = "resident@demo.com";
const PASSWORD = "password123!";

const results = { timestamp: new Date().toISOString(), sections: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

async function timed(fn) {
  const t0 = now();
  let status = null, ok = false, err = null, bytes = 0;
  try {
    const r = await fn();
    status = r.status;
    const buf = await r.arrayBuffer();
    bytes = buf.byteLength;
    ok = r.ok;
    return { ms: now() - t0, status, ok, bytes };
  } catch (e) {
    return { ms: now() - t0, status, ok: false, err: String(e).slice(0, 200), bytes };
  }
}

function stats(samples) {
  const s = samples.map((x) => x.ms).sort((a, b) => a - b);
  const p50 = s[Math.ceil(0.5 * s.length) - 1];
  const p95 = s[Math.ceil(0.95 * s.length) - 1];
  return {
    n: s.length,
    p50: +p50.toFixed(1),
    p95: +p95.toFixed(1),
    min: +s[0].toFixed(1),
    max: +s[s.length - 1].toFixed(1),
    statuses: samples.map((x) => x.status),
    errors: samples.filter((x) => x.err || x.ok === false).length,
  };
}

function authHeaders(token) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ---------- 1. AUTH LOGIN (5 iterations, paced ~3s) ----------
console.log("== auth login ==");
const loginSamples = [];
for (let i = 0; i < 5; i++) {
  if (i > 0) await sleep(3000);
  const t = await timed(() =>
    fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
  );
  loginSamples.push(t);
  console.log(`login ${i + 1}: ${t.ms.toFixed(0)}ms status=${t.status}`);
  if (i === 0 && !t.ok) break;
}
results.sections.auth_login = stats(loginSamples);

// Parse session from a successful login
let token = null, userId = null;
for (const t of loginSamples) {
  if (t.ok && t._json) break;
}
// re-login once (not timed) to grab the session payload
await sleep(3000);
const sessRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!sessRes.ok) {
  console.error("FATAL: could not authenticate", sessRes.status, await sessRes.text());
  writeFileSync(new URL("./perf_results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exit(1);
}
const sess = await sessRes.json();
token = sess.access_token;
userId = sess.user.id;
console.log("session acquired, user:", userId);

const H = authHeaders(token);
const rest = SUPABASE_URL + "/rest/v1";

// ---------- helper for repeated GET/POST benchmarks ----------
async function bench(name, makeReq, iterations = 5) {
  console.log(`== ${name} ==`);
  // warmup (untimed)
  try {
    const w = await makeReq();
    await w.arrayBuffer();
  } catch {}
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t = await timed(makeReq);
    samples.push(t);
    console.log(`${name} ${i + 1}: ${t.ms.toFixed(0)}ms status=${t.status}`);
    await sleep(250);
  }
  results.sections[name] = stats(samples);
}

// ---------- 2. RPC get_dashboard_data ----------
await bench("rpc_get_dashboard_data", () =>
  fetch(`${rest}/rpc/get_dashboard_data`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ p_tenant_id: TENANT_ID, p_resident_id: userId, p_role: "resident" }),
  })
);

// ---------- 3. case_entries list limit 20 ----------
await bench("case_entries_list_limit20", () =>
  fetch(`${rest}/case_entries?select=id,status,case_date,created_at&tenant_id=eq.${TENANT_ID}&order=created_at.desc&limit=20`, { headers: H })
);

// ---------- 4. case_templates search ----------
await bench("case_templates_search", () =>
  fetch(`${rest}/case_templates?select=id,name,specialty&tenant_id=eq.${TENANT_ID}&name=ilike.*a*&limit=10`, { headers: H })
);

// ---------- 5. rpc hash_patient_mrn ----------
await bench("rpc_hash_patient_mrn", () =>
  fetch(`${rest}/rpc/hash_patient_mrn`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ p_mrn: "PERF-AUDIT-MRN-001", p_tenant_id: TENANT_ID }),
  })
);

// ---------- 6. rpc check_case_quota ----------
await bench("rpc_check_case_quota", () =>
  fetch(`${rest}/rpc/check_case_quota`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ p_tenant_id: TENANT_ID }),
  })
);

// ---------- 7. evaluations list ----------
await bench("evaluations_list", () =>
  fetch(`${rest}/evaluations?select=id,status,created_at&order=created_at.desc&limit=20`, { headers: H })
);

// ---------- 8. notifications list ----------
await bench("notifications_list", () =>
  fetch(`${rest}/notifications?select=id,title,is_read,created_at&order=created_at.desc&limit=20`, { headers: H })
);

// ---------- 9. sync_push_batch 10-row batch (<400ms), then tombstone ----------
console.log("== sync_push_batch_10rows ==");
// pick an existing template for FK
let templateId = null;
{
  const r = await fetch(`${rest}/case_templates?select=id&tenant_id=eq.${TENANT_ID}&limit=1`, { headers: H });
  const arr = await r.json();
  templateId = Array.isArray(arr) && arr[0] ? arr[0].id : null;
}
results.sync_template_found = !!templateId;

if (templateId) {
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
    });
  }
  const syncSamples = [];
  for (let i = 0; i < 5; i++) {
    const batchIds = ids.map((id) => id); // same rows -> update path after first run
    const t = await timed(() =>
      fetch(`${rest}/rpc/sync_push_batch`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ p_table_name: "case_entries", p_rows: batchIds.map((id, idx) => ({ ...rows[idx] })) }),
      })
    );
    syncSamples.push(t);
    console.log(`sync_push_batch ${i + 1}: ${t.ms.toFixed(0)}ms status=${t.status}`);
    await sleep(250);
  }
  results.sections.sync_push_batch_10rows = stats(syncSamples);

  // tombstone all created rows
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
  results.created_row_ids = ids;
} else {
  results.sections.sync_push_batch_10rows = { error: "no template found" };
}

// ---------- 10. Prod TTFB (3 runs each) ----------
console.log("== prod TTFB ==");
const pages = ["/login", "/pricing", "/"];
results.sections.prod_ttfb = {};
for (const page of pages) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const t = await timed(() => fetch(`https://elogbook-web.vercel.app${page}`, { redirect: "manual" }));
    samples.push(t);
    console.log(`TTFB ${page} ${i + 1}: ${t.ms.toFixed(0)}ms status=${t.status}`);
    await sleep(500);
  }
  results.sections.prod_ttfb[page] = stats(samples);
}

// ---------- 11. Edge functions POST empty body ----------
console.log("== edge functions ==");
const fns = ["payment-webhook", "create-checkout", "list-invoices", "ai-quality"];
results.sections.edge_functions = {};
for (const fn of fns) {
  const t = await timed(() =>
    fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
      body: "",
    })
  );
  console.log(`edge ${fn}: ${t.ms.toFixed(0)}ms status=${t.status}`);
  results.sections.edge_functions[fn] = { ...stats([t]), note: "single run" };
  await sleep(300);
}

writeFileSync(new URL("./perf_results.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("DONE");
