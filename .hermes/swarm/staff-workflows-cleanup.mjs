// Follow-up: diagnose resident tombstone 403, clean up cases via supervisor, re-verify
const URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWVkeGt6YWltbHphZXRicGF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDQ3OTI1OSwiZXhwIjoyMDk2MDU1MjU5fQ.wfTneCBjYGfSvmo-GGTSEBv3JwkbSl8QByWR__WVpJg';
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const CASE1 = 'df2496a4-207a-4991-ac03-55676c9e4219';
const CASE2 = 'c5230a8b-ea0c-464e-87da-e53eec66d7bf';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, pw = 'password123!') {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return j;
}
async function svc(method, path, body) {
  const r = await fetch(`${URL}/rest/v1${path}`, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t.slice(0, 200); }
  return { status: r.status, json: j };
}
function rest(tok) {
  return async (method, path, body) => {
    const r = await fetch(`${URL}/rest/v1${path}`, {
      method,
      headers: { apikey: KEY, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t.slice(0, 200); }
    return { status: r.status, json: j };
  };
}

// 0. state before
const before = await svc('GET', `/case_entries?id=in.(${CASE1},${CASE2})&select=id,status,deleted_at`);
console.log('BEFORE:', JSON.stringify(before.json));

// 1. diagnostic RPC left by earlier swarm run (impersonates resident)
const diag = await svc('POST', '/rpc/debug_swarm_introspect', { p_mode: 'tombstone', p_id: CASE1 });
console.log('DIAG(imapersonated-resident tombstone):', JSON.stringify(diag));
await sleep(500);
const diagAll = await svc('POST', '/rpc/debug_swarm_introspect', { p_mode: 'all' });
console.log('DIAG(predicates):', JSON.stringify(diagAll));

// 2. supervisor tombstone fallback
await sleep(2500);
const supAuth = await login('supervisor@demo.com');
const S = rest(supAuth.access_token);
const now = new Date().toISOString();
const tb1 = await S('PATCH', `/case_entries?id=eq.${CASE1}`, { deleted_at: now }, { Prefer: 'return=representation' });
console.log('SUP tombstone CASE1:', tb1.status, JSON.stringify(tb1.json)?.slice(0, 120));
await sleep(500);
const tb2 = await S('PATCH', `/case_entries?id=eq.${CASE2}`, { deleted_at: now }, { Prefer: 'return=representation' });
console.log('SUP tombstone CASE2:', tb2.status, JSON.stringify(tb2.json)?.slice(0, 120));

// 3. final state + leftover sweep (retry-safe)
await sleep(1000);
for (let i = 0; i < 3; i++) {
  const after = await svc('GET', `/case_entries?id=in.(${CASE1},${CASE2})&select=id,status,deleted_at`);
  if (after.status === 200 && Array.isArray(after.json)) {
    console.log('AFTER:', JSON.stringify(after.json));
    break;
  }
  console.log(`verify attempt ${i + 1} failed http=${after.status}, retrying`);
  await sleep(2000);
}
const leftovers = await svc('GET', `/case_templates?select=id,name&name=like.*Swarm*`);
console.log('templates like Swarm*:', leftovers.status, JSON.stringify(leftovers.json));
const goalsLeft = await svc('GET', `/program_goals?select=id,title&title=like.*Staff Swarm Goal*`);
console.log('goals left:', goalsLeft.status, JSON.stringify(goalsLeft.json));
const whLeft = await svc('GET', `/tenant_webhooks?select=id,url&tenant_id=eq.${TENANT}`);
console.log('webhooks left:', whLeft.status, JSON.stringify(whLeft.json));
const evLeft = await svc('GET', `/evaluation_forms?select=id&tenant_id=eq.${TENANT}&feedback=eq.staff%20swarm%20msf`);
console.log('evals left:', evLeft.status, JSON.stringify(evLeft.json));
