import { writeFileSync } from "node:fs";

const SUPABASE_URL = "https://nuyedxkzaimlzaetbpaw.supabase.co";
const ANON_KEY = "sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3";
const rest = SUPABASE_URL + "/rest/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

async function timed(fn) {
  const t0 = performance.now();
  try {
    const r = await fn();
    await r.arrayBuffer();
    return { ms: performance.now() - t0, status: r.status };
  } catch (e) {
    return { ms: performance.now() - t0, status: null, err: String(e).slice(0, 150) };
  }
}

// 5 more paced logins
console.log("== auth login round 2 ==");
const logins = [];
for (let i = 0; i < 5; i++) {
  if (i > 0) await sleep(3000);
  const t = await timed(() =>
    fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "resident@demo.com", password: "password123!" }),
    })
  );
  logins.push(t);
  console.log(`login ${i + 1}: ${t.ms.toFixed(0)}ms status=${t.status}`);
}
out.auth_login_round2 = logins;

// fresh token
await sleep(3000);
const sess = await (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "resident@demo.com", password: "password123!" }),
})).json();
const H = { apikey: ANON_KEY, Authorization: `Bearer ${sess.access_token}`, "Content-Type": "application/json" };

async function bench(name, url) {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    if (i > 0) await sleep(250);
    const t = await timed(() => fetch(url, { headers: H }));
    samples.push(t);
    console.log(`${name} ${i + 1}: ${t.ms.toFixed(0)}ms status=${t.status}`);
  }
  out[name] = samples;
}

console.log("== case_templates search round 2 ==");
await bench("case_templates_search_r2", `${rest}/case_templates?select=id,name,specialty&name=ilike.*a*&limit=10`);
console.log("== evaluations round 2 ==");
await bench("evaluations_list_r2", `${rest}/faculty_evaluations?select=id,evaluation_date,created_at&order=created_at.desc&limit=20`);

// prod TTFB round 2 for /login and /pricing
for (const page of ["/login", "/pricing"]) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(500);
    const t = await timed(() => fetch(`https://elogbook-web.vercel.app${page}`, { redirect: "manual" }));
    samples.push(t);
    console.log(`TTFB ${page} r2-${i + 1}: ${t.ms.toFixed(0)}ms status=${t.status}`);
  }
  out[`ttfb_${page}_r2`] = samples;
}

writeFileSync(new URL("./perf_results_confirm.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("DONE");
