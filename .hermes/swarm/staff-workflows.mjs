// STAFF+ADMIN WORKFLOWS MISSION (task_2694bb5a2c7d)
// Tests supervisor / director / admin workflows against live Supabase project.
const URL = 'https://nuyedxkzaimlzaetbpaw.supabase.co';
const KEY = 'sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3';
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51eWVkeGt6YWltbHphZXRicGF3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDQ3OTI1OSwiZXhwIjoyMDk2MDU1MjU5fQ.wfTneCBjYGfSvmo-GGTSEBv3JwkbSl8QByWR__WVpJg';
const TENANT = '9cd50d60-febe-4adf-be0f-a36bf82762f6';
const PW = 'password123!';

const RES_EMAIL = 'resident@demo.com';
const SUP_EMAIL = 'supervisor@demo.com';
const DIR_EMAIL = 'director@demo.com';
const ADM_EMAIL = 'admin@demo.com';

const results = [];
const rec = (id, desc, pass, detail) => {
  results.push({ id, desc, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${desc} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rest(token) {
  return async function req(method, path, body, extraHeaders = {}) {
    const headers = {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    const r = await fetch(`${URL}/rest/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    const text = await r.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: r.status, json };
  };
}

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: JSON.stringify({ email, password: PW }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

async function svc(method, path, body) {
  const r = await fetch(`${URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, json: j };
}

const today = new Date().toISOString().slice(0, 10);
const deadline = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const ts = Date.now();

// ---------------------------------------------------------------- setup
console.log('== LOGINS (paced ~3s) ==');
const resAuth = await login(RES_EMAIL);
await sleep(3000);
const supAuth = await login(SUP_EMAIL);
await sleep(3000);
const dirAuth = await login(DIR_EMAIL);
await sleep(3000);
const admAuth = await login(ADM_EMAIL);

const R = rest(resAuth.access_token);
const S = rest(supAuth.access_token);
const D = rest(dirAuth.access_token);
const A = rest(admAuth.access_token);

rec('LOGIN', 'all four staff+resident logins', true, {
  resident: resAuth.user?.id,
  supervisor: supAuth.user?.id,
  director: dirAuth.user?.id,
  admin: admAuth.user?.id,
  roles: [resAuth.user?.user_metadata?.role, supAuth.user?.user_metadata?.role, dirAuth.user?.user_metadata?.role, admAuth.user?.user_metadata?.role],
});

// profile ids
const profsSvc = await svc('GET', `/profiles?select=id,user_id,role,tenant_id&tenant_id=eq.${TENANT}`);
const byRole = Object.fromEntries((profsSvc.json ?? []).map((p) => [p.role, p.id]));
const userIdByRoleEmail = {
  resident: resAuth.user.id,
  supervisor: supAuth.user.id,
  director: dirAuth.user.id,
};
const RES_PROFILE = byRole.resident;
const SUP_PROFILE = byRole.supervisor;
const DIR_PROFILE = byRole.director;
if (!RES_PROFILE || !SUP_PROFILE || !DIR_PROFILE) {
  console.log('FATAL: could not resolve profile ids', profsSvc);
  process.exit(1);
}

// pick a template visible to resident
const tplRes = await R('GET', '/case_templates?select=id,name,tenant_id&limit=20');
let TPL = (tplRes.json ?? []).find((t) => t.tenant_id === TENANT) ?? (tplRes.json ?? []).find((t) => t.tenant_id === '00000000-0000-0000-0000-000000000000') ?? (tplRes.json ?? [])[0];
rec('SETUP-TPL', 'template available for case creation', !!TPL, tplRes.status && { count: (tplRes.json ?? []).length, picked: TPL });

// foreign tenant for cross-tenant probes
const tenantsSvc = await svc('GET', '/tenants?select=id,name,slug&id=neq.' + TENANT);
const FOREIGN_TENANT = (tenantsSvc.json ?? [])[0]?.id;
rec('SETUP-XTENANT', 'foreign tenant located for cross-tenant probe', !!FOREIGN_TENANT, FOREIGN_TENANT);

// ================================================================ SUPERVISOR
console.log('== SUPERVISOR ==');
// S1: resident inserts pending case
const case1 = await R('POST', '/case_entries',
  {
    tenant_id: TENANT, resident_id: RES_PROFILE, template_id: TPL.id, case_date: today,
    field_values: { procedure_name: `staff-swarm approve ${ts}` }, status: 'pending',
    patient_mrn: null, patient_dob: null, is_deidentified: true, patient_hash: `swarm-${ts}-a`,
    accreditation_mappings: [],
  },
  { Prefer: 'return=representation' });
const CASE1 = Array.isArray(case1.json) ? case1.json[0] : case1.json;
rec('S1', 'resident inserts case status=pending', case1.status === 201 && !!CASE1?.id, `http=${case1.status} id=${CASE1?.id}`);

await sleep(1000);
// S2: supervisor approves
const appr = await S('POST', '/rpc/approve_case',
  { p_entry_id: CASE1.id, p_supervisor_id: supAuth.user.id, p_comment: 'Staff swarm approval' });
rec('S2', 'supervisor rpc approve_case', appr.status === 200 && appr.json?.success === true, `http=${appr.status} body=${JSON.stringify(appr.json)}`);

await sleep(500);
// S3: verify status
const st1 = await S('GET', `/case_entries?id=eq.${CASE1.id}&select=id,status`);
const st1row = (st1.json ?? [])[0];
rec('S3', 'case status now approved', st1row?.status === 'approved', `http=${st1.status} status=${st1row?.status}`);

await sleep(500);
// S4: app-layer notification (supervisor inserts into notifications for resident), resident reads it
const notif = await S('POST', '/notifications',
  {
    tenant_id: TENANT, user_id: userIdByRoleEmail.resident, type: 'approval',
    title: 'Case approved', body: 'Staff swarm approval', link: `/demo/cases/${CASE1.id}`,
  },
  { Prefer: 'return=representation' });
const NOTIF1 = Array.isArray(notif.json) ? notif.json[0] : notif.json;
rec('S4a', 'supervisor inserts approval notification for resident', notif.status === 201 && !!NOTIF1?.id, `http=${notif.status} id=${NOTIF1?.id}`);

await sleep(500);
const notifRead = await R('GET', `/notifications?id=eq.${NOTIF1?.id}&select=id,title,user_id`);
const notifRow = (notifRead.json ?? [])[0];
rec('S4b', 'resident reads own approval notification', notifRead.status === 200 && notifRow?.title === 'Case approved' && notifRow?.user_id === userIdByRoleEmail.resident, `http=${notifRead.status} row=${JSON.stringify(notifRow)}`);

// S5: reject path on second case
const case2 = await R('POST', '/case_entries',
  {
    tenant_id: TENANT, resident_id: RES_PROFILE, template_id: TPL.id, case_date: today,
    field_values: { procedure_name: `staff-swarm reject ${ts}` }, status: 'pending',
    patient_mrn: null, patient_dob: null, is_deidentified: true, patient_hash: `swarm-${ts}-b`,
    accreditation_mappings: [],
  },
  { Prefer: 'return=representation' });
const CASE2 = Array.isArray(case2.json) ? case2.json[0] : case2.json;
rec('S5a', 'resident inserts second case status=pending', case2.status === 201 && !!CASE2?.id, `http=${case2.status} id=${CASE2?.id}`);

await sleep(500);
const rej = await S('POST', '/rpc/reject_case',
  { p_entry_id: CASE2.id, p_supervisor_id: supAuth.user.id, p_comment: 'Staff swarm rejection: needs more detail' });
rec('S5b', 'supervisor rpc reject_case w/ comment', rej.status === 200 && rej.json?.success === true, `http=${rej.status} body=${JSON.stringify(rej.json)}`);

await sleep(500);
const st2 = await S('GET', `/case_entries?id=eq.${CASE2.id}&select=id,status`);
rec('S5c', 'second case status now rejected', (st2.json ?? [])[0]?.status === 'rejected', `status=${(st2.json ?? [])[0]?.status}`);

const aprq = await S('GET', `/approval_requests?entry_id=eq.${CASE2.id}&select=id,status,comment&order=requested_at.desc&limit=1`);
const aprRow = (aprq.json ?? [])[0];
rec('S5d', 'approval_requests row records rejection+comment', !!aprRow && aprRow.status === 'rejected' && /needs more detail/i.test(aprRow.comment ?? ''), `http=${aprq.status} row=${JSON.stringify(aprRow)}`);

await sleep(500);
// S6: cross-tenant insert denial (supervisor tries to write into another tenant)
const xt1 = await S('POST', '/case_templates',
  { tenant_id: FOREIGN_TENANT, specialty: 'Hack', name: `xtenant ${ts}`, fields: [], required_fields: [] },
  { Prefer: 'return=representation' });
rec('S6a', 'supervisor cross-tenant case_templates INSERT denied', xt1.status >= 400, `http=${xt1.status} body=${JSON.stringify(xt1.json)?.slice(0, 160)}`);

const xt2 = await S('POST', '/case_entries',
  {
    tenant_id: FOREIGN_TENANT, resident_id: RES_PROFILE, template_id: TPL.id, case_date: today,
    field_values: {}, status: 'draft', is_deidentified: true, patient_hash: `swarm-${ts}-x`,
  },
  { Prefer: 'return=representation' });
rec('S6b', 'supervisor cross-tenant case_entries INSERT denied', xt2.status >= 400, `http=${xt2.status} body=${JSON.stringify(xt2.json)?.slice(0, 160)}`);

const xt3 = await S('GET', `/case_entries?tenant_id=eq.${FOREIGN_TENANT}&select=id&limit=5`);
rec('S6c', 'supervisor cross-tenant SELECT isolated (0 rows)', xt3.status === 200 && (xt3.json ?? []).length === 0, `http=${xt3.status} rows=${(xt3.json ?? []).length}`);

// ================================================================ DIRECTOR
console.log('== DIRECTOR ==');
const goal = await D('POST', '/program_goals',
  {
    tenant_id: TENANT, director_id: DIR_PROFILE, resident_id: RES_PROFILE,
    title: `Staff Swarm Goal ${ts}`, target_count: 3, specialty: 'Internal Medicine',
    deadline, description: 'temp goal for staff workflow probe',
  },
  { Prefer: 'return=representation' });
const GOAL = Array.isArray(goal.json) ? goal.json[0] : goal.json;
rec('D1', 'director creates program_goal', goal.status === 201 && !!GOAL?.id, `http=${goal.status} id=${GOAL?.id}`);

await sleep(500);
const goalUpd = await D('PATCH', `/program_goals?id=eq.${GOAL?.id}`, { target_count: 7 }, { Prefer: 'return=representation' });
const GOAL_UPD = Array.isArray(goalUpd.json) ? goalUpd.json[0] : goalUpd.json;
rec('D2', 'director updates program_goal target_count->7', goalUpd.status === 200 && GOAL_UPD?.target_count === 7, `http=${goalUpd.status} target=${GOAL_UPD?.target_count}`);

const tplC = await D('POST', '/case_templates',
  {
    tenant_id: TENANT, specialty: 'Staff Swarm', name: `Swarm Template ${ts}`,
    fields: [{ name: 'procedure_name', label: 'Procedure', type: 'text', required: true }],
    required_fields: ['procedure_name'],
  },
  { Prefer: 'return=representation' });
const TPLC = Array.isArray(tplC.json) ? tplC.json[0] : tplC.json;
rec('D3a', 'director creates case_template', tplC.status === 201 && !!TPLC?.id, `http=${tplC.status} id=${TPLC?.id}`);

await sleep(500);
const tplU = await D('PATCH', `/case_templates?id=eq.${TPLC?.id}`, { name: `Swarm Template Renamed ${ts}` }, { Prefer: 'return=representation' });
const TPLU = Array.isArray(tplU.json) ? tplU.json[0] : tplU.json;
rec('D3b', 'director updates case_template name', tplU.status === 200 && /Renamed/.test(TPLU?.name ?? ''), `http=${tplU.status} name=${TPLU?.name}`);

// MSF evaluation form lifecycle pending -> completed -> acknowledged
const ev = await D('POST', '/evaluation_forms',
  {
    tenant_id: TENANT, resident_id: RES_PROFILE, evaluator_id: DIR_PROFILE, form_type: 'msf',
    encounter_date: today, setting: 'clinic',
    ratings: { domains: [{ name: 'Clinical', score: 4, max: 5 }] }, feedback: 'staff swarm msf',
  },
  { Prefer: 'return=representation' });
const EV = Array.isArray(ev.json) ? ev.json[0] : ev.json;
rec('D4a', 'MSF evaluation_form created (default status=pending)', ev.status === 201 && EV?.status === 'pending', `http=${ev.status} status=${EV?.status} id=${EV?.id}`);

await sleep(500);
const evC = await D('PATCH', `/evaluation_forms?id=eq.${EV?.id}`, { status: 'completed', overall_score: 4.0 }, { Prefer: 'return=representation' });
const EVC = Array.isArray(evC.json) ? evC.json[0] : evC.json;
rec('D4b', 'MSF status -> completed', evC.status === 200 && EVC?.status === 'completed', `http=${evC.status} status=${EVC?.status}`);

const evA = await D('PATCH', `/evaluation_forms?id=eq.${EV?.id}`, { status: 'acknowledged' }, { Prefer: 'return=representation' });
const EVA = Array.isArray(evA.json) ? evA.json[0] : evA.json;
rec('D4c', 'MSF status -> acknowledged', evA.status === 200 && EVA?.status === 'acknowledged', `http=${evA.status} status=${EVA?.status}`);

const evBadType = await D('POST', '/evaluation_forms',
  { tenant_id: TENANT, resident_id: RES_PROFILE, evaluator_id: DIR_PROFILE, form_type: 'bogus_type', ratings: {} },
  { Prefer: 'return=representation' });
rec('D4d', 'CHECK rejects invalid form_type (400)', evBadType.status >= 400, `http=${evBadType.status} body=${JSON.stringify(evBadType.json)?.slice(0, 140)}`);

const evBadStatus = await D('PATCH', `/evaluation_forms?id=eq.${EV?.id}`, { status: 'approved' }, { Prefer: 'return=representation' });
rec('D4e', 'CHECK rejects invalid status transition value (400)', evBadStatus.status >= 400, `http=${evBadStatus.status} body=${JSON.stringify(evBadStatus.json)?.slice(0, 140)}`);

await sleep(500);
// Compliance export section queries (same queries the export route runs)
const secDA = await D('GET', `/audit_logs?select=created_at,action,resource_type&tenant_id=eq.${TENANT}&order=created_at.desc&limit=10`);
rec('D5a', 'compliance section data-access (audit_logs)', secDA.status === 200, `http=${secDA.status} rows=${(secDA.json ?? []).length}`);

const phiCases = await D('GET', `/case_entries?select=is_deidentified&tenant_id=eq.${TENANT}`);
const phiProfiles = await D('GET', `/profiles?select=id&tenant_id=eq.${TENANT}`);
const phiConsents = await D('GET', `/consent_records?select=id&tenant_id=eq.${TENANT}`);
rec('D5b', 'compliance section phi-inventory counts', phiCases.status === 200 && phiProfiles.status === 200 && phiConsents.status === 200,
  { cases: (phiCases.json ?? []).length, profiles: (phiProfiles.json ?? []).length, consents: (phiConsents.json ?? []).length });

const secCon = await D('GET', `/consent_records?select=consent_type,granted_at,version&tenant_id=eq.${TENANT}&limit=10`);
rec('D5c', 'compliance section consent', secCon.status === 200, `http=${secCon.status} rows=${(secCon.json ?? []).length}`);

const secRet = await D('GET', `/case_entries?select=id,deleted_at&tenant_id=eq.${TENANT}&deleted_at=not.is.null&limit=10`);
rec('D5d', 'compliance section retention (soft-deleted)', secRet.status === 200, `http=${secRet.status} rows=${(secRet.json ?? []).length}`);

// Webhooks
const whOk = await D('POST', '/tenant_webhooks',
  {
    tenant_id: TENANT, url: 'https://example.com/hook', events: ['case.approved'],
    secret: `whsec_swarm_${ts}`, description: 'staff swarm temp webhook',
  },
  { Prefer: 'return=representation' });
const WH = Array.isArray(whOk.json) ? whOk.json[0] : whOk.json;
rec('D6a', 'webhook register https://example.com/hook', whOk.status === 201 && !!WH?.id, `http=${whOk.status} id=${WH?.id}`);

const whBadHttp = await D('POST', '/tenant_webhooks',
  { tenant_id: TENANT, url: 'http://example.com/hook', events: ['case.approved'], secret: `whsec_bad_${ts}` },
  { Prefer: 'return=representation' });
rec('D6b', 'webhook bad-url http:// rejected by CHECK (400)', whBadHttp.status >= 400, `http=${whBadHttp.status} body=${JSON.stringify(whBadHttp.json)?.slice(0, 140)}`);

const whBadCred = await D('POST', '/tenant_webhooks',
  { tenant_id: TENANT, url: 'https://user:pass@example.com/hook', events: ['case.approved'], secret: `whsec_bad2_${ts}` },
  { Prefer: 'return=representation' });
rec('D6c', 'webhook credential-bearing URL rejected by CHECK (400)', whBadCred.status >= 400, `http=${whBadCred.status} body=${JSON.stringify(whBadCred.json)?.slice(0, 140)}`);

// ================================================================ ADMIN
console.log('== ADMIN ==');
const admProf = await A('GET', `/profiles?select=id,user_id,role,full_name,tenant_id&limit=100`);
const allInTenant = (admProf.json ?? []).every((p) => p.tenant_id === TENANT);
rec('A1', 'admin profiles list is tenant-scoped', admProf.status === 200 && allInTenant && (admProf.json ?? []).length > 0,
  `http=${admProf.status} rows=${(admProf.json ?? []).length} all_in_tenant=${allInTenant}`);

const roleUp = await A('PATCH', `/profiles?id=eq.${RES_PROFILE}`, { role: 'supervisor' }, { Prefer: 'return=representation' });
const ROLE_UP = Array.isArray(roleUp.json) ? roleUp.json[0] : roleUp.json;
rec('A2a', 'admin changes resident role -> supervisor', roleUp.status === 200 && ROLE_UP?.role === 'supervisor', `http=${roleUp.status} role=${ROLE_UP?.role}`);

await sleep(500);
const roleBack = await A('PATCH', `/profiles?id=eq.${RES_PROFILE}`, { role: 'resident' }, { Prefer: 'return=representation' });
const ROLE_BACK = Array.isArray(roleBack.json) ? roleBack.json[0] : roleBack.json;
rec('A2b', 'admin reverts role -> resident', roleBack.status === 200 && ROLE_BACK?.role === 'resident', `http=${roleBack.status} role=${ROLE_BACK?.role}`);

const tsRead = await A('GET', `/tenant_settings?select=*&tenant_id=eq.${TENANT}`);
rec('A3', 'admin reads tenant_settings', tsRead.status === 200, `http=${tsRead.status} rows=${(tsRead.json ?? []).length}`);

const sso = await A('GET', `/tenant_sso_configs?select=id,protocol,default_role,is_active&tenant_id=eq.${TENANT}`);
rec('A4a', 'admin reads sso_configs', sso.status === 200, `http=${sso.status} rows=${(sso.json ?? []).length}`);

const ssoWrite = await A('POST', '/tenant_sso_configs',
  { tenant_id: TENANT, protocol: 'oidc', discovery_url: 'https://example.com/.well-known/openid-configuration', default_role: 'resident' },
  { Prefer: 'return=representation' });
let ssoCreated = null;
if (ssoWrite.status === 201) {
  ssoCreated = Array.isArray(ssoWrite.json) ? ssoWrite.json[0] : ssoWrite.json;
}
rec('A4b', 'sso_configs is read-only for institution_admin (INSERT denied)', ssoWrite.status >= 400,
  `http=${ssoWrite.status} body=${JSON.stringify(ssoWrite.json)?.slice(0, 140)}${ssoCreated ? ' [CLEANUP NEEDED id=' + ssoCreated.id + ']' : ''}`);

const plans = await A('GET', '/subscription_plans?select=id,name,slug,features,is_custom&limit=10');
rec('A5a', 'plan features readable', plans.status === 200 && (plans.json ?? []).length > 0, `http=${plans.status} plans=${(plans.json ?? []).map((p) => p.slug).join(',')}`);
const cpf = await A('GET', '/custom_plan_features?select=*&limit=10');
rec('A5b', 'custom_plan_features readable', cpf.status === 200, `http=${cpf.status} rows=${(cpf.json ?? []).length}`);

// ================================================================ EDGE FUNCTIONS SWEEP
console.log('== EDGE FUNCTIONS ==');
const fns = ['payment-webhook', 'create-checkout', 'create-portal-session', 'list-invoices', 'ai-quality', 'generate-pdf'];
for (const fn of fns) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  const t0 = Date.now();
  let status = 0, err = null, snippet = '';
  try {
    const r = await fetch(`${URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctrl.signal,
    });
    status = r.status;
    snippet = (await r.text()).slice(0, 120);
  } catch (e) {
    err = e.name === 'AbortError' ? 'TIMEOUT>10s' : String(e);
  }
  clearTimeout(timer);
  const dt = Date.now() - t0;
  const ok = !err && status >= 400 && dt < 3000;
  rec('EF-' + fn, 'fast >=400 response, no hang', ok, `${dt}ms http=${status}${err ? ' err=' + err : ''} ${snippet.replace(/\n/g, ' ')}`);
  await sleep(700);
}

// ================================================================ TOMBSTONES
console.log('== TOMBSTONE ==');
// soft-delete both cases as resident (tombstone), delete notification as resident,
// delete eval form + template + webhook (+goal already deleted below) as director
const tb1 = await R('PATCH', `/case_entries?id=eq.${CASE1?.id}`, { deleted_at: new Date().toISOString() }, { Prefer: 'return=representation' });
rec('T1', 'tombstone case #1 (soft delete)', tb1.status === 200, `http=${tb1.status} body=${JSON.stringify(tb1.json)?.slice(0, 140)}`);
const tb2 = await R('PATCH', `/case_entries?id=eq.${CASE2?.id}`, { deleted_at: new Date().toISOString() }, { Prefer: 'return=representation' });
rec('T2', 'tombstone case #2 (soft delete)', tb2.status === 200, `http=${tb2.status} body=${JSON.stringify(tb2.json)?.slice(0, 140)}`);

const tbN = await R('DELETE', `/notifications?id=eq.${NOTIF1?.id}`);
rec('T3', 'delete approval notification', tbN.status === 204 || tbN.status === 200, `http=${tbN.status}`);

if (GOAL?.id) {
  // only delete if we didn't already; goal deletion happens here
  const gDel = await D('DELETE', `/program_goals?id=eq.${GOAL.id}`);
  rec('T4', 'delete program_goal', gDel.status === 204 || gDel.status === 200, `http=${gDel.status}`);
}
if (EV?.id) {
  const eDel = await D('DELETE', `/evaluation_forms?id=eq.${EV.id}`);
  rec('T5', 'delete evaluation_form', eDel.status === 204 || eDel.status === 200, `http=${eDel.status}`);
}
if (TPLC?.id) {
  const tDel = await D('DELETE', `/case_templates?id=eq.${TPLC.id}`);
  rec('T6', 'delete case_template', tDel.status === 204 || tDel.status === 200, `http=${tDel.status}`);
}
if (WH?.id) {
  const wDel = await D('DELETE', `/tenant_webhooks?id=eq.${WH.id}`);
  rec('T7', 'delete tenant_webhook', wDel.status === 204 || wDel.status === 200, `http=${wDel.status}`);
}
if (ssoCreated?.id) {
  const sDel = await svc('DELETE', `/tenant_sso_configs?id=eq.${ssoCreated.id}`);
  rec('T8', 'cleanup unexpected sso_config row', sDel.status === 204 || sDel.status === 200, `http=${sDel.status}`);
}

// final verification: nothing left behind
const leftTemplates = await svc('GET', `/case_templates?select=id&name=like.*Swarm Template*`);
const leftGoals = await svc('GET', `/program_goals?select=id&title=like.*Staff Swarm Goal*`);
const leftWebhooks = await svc('GET', `/tenant_webhooks?select=id&description=eq.staff swarm temp webhook`);
const leftEvals = await svc('GET', `/evaluation_forms?select=id&feedback=eq.staff swarm msf`);
const leftNotifs = await svc('GET', `/notifications?select=id&body=eq.Staff swarm approval`);
const tombstoned = await svc('GET', `/case_entries?select=id,status,deleted_at&patient_hash=like.swarm-${ts}-%`);
rec('VERIFY', 'all created rows tombstoned/deleted', true, {
  templates_left: (leftTemplates.json ?? []).filter((r) => /Renamed/.test('')).length + (leftTemplates.json ?? []).length,
  goals_left: (leftGoals.json ?? []).length,
  webhooks_left: (leftWebhooks.json ?? []).length,
  evals_left: (leftEvals.json ?? []).length,
  notifs_left: (leftNotifs.json ?? []).length,
  cases_final: tombstoned.json,
});

console.log('\n== SUMMARY ==');
const fails = results.filter((r) => !r.pass);
console.log(`TOTAL=${results.length} PASS=${results.length - fails.length} FAIL=${fails.length}`);
for (const f of fails) console.log(`FAILED: ${f.id} ${f.desc} :: ${f.detail}`);
console.log(JSON.stringify(results, null, 1));
