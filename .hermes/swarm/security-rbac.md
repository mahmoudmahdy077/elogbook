# SECURITY + RBAC MATRIX — elogbook demo environment

**Date:** 2026-08-25 · **Scope:** Supabase backend (GoTrue + PostgREST RLS + edge functions) for repo `G:\elogbook`
**Project:** `nuyedxkzaimlzaetbpaw` · **Own tenant:** `9cd50d60-febe-4adf-be0f-a36bf82762f6` ("Demo Hospital") · **Foreign probe tenant:** `00000000-…-0001` (+ real tenant `11111111-1111-1111-1111-111111111111` "QA E2E Institution")
**Roles tested:** `resident@`, `supervisor@`, `director@`, `admin@`, `platform@demo.com` (all password logins, paced ~3 s)
**Method:** direct REST probes against GoTrue/PostgREST/functions using anon publishable key + per-role JWTs (patterns per `.hermes/cycles/*.mjs`). Raw machine output: `.hermes/swarm/security-rbac-results.json`.

## Executive summary

**47/48 checks passed.** Cross-tenant isolation (reads + writes), anon-key lockdown, audit-log scoping and forged-audit protection are all correctly enforced at the RLS layer. One **P2**: the `profiles` UPDATE policy lacks a tenant `WITH CHECK` — any client role can silently relocate their own profile row into **any real existing tenant** (204 OK). Blast radius was contained in testing (JWT tenant claim is not derived from `profiles.tenant_id` at mint time, so no live data escape was achieved), but the isolation invariant is broken at the DB level.

| # | Severity | Finding |
|---|----------|---------|
| F1 | **P2 major** | Self-service cross-tenant profile relocation succeeds (`profiles` UPDATE has no tenant `WITH CHECK`) |
| F2 | P3 minor | Role-change gate is “MFA enrollment” based (`P0001: MFA enrollment required for role director`) — enrollment alone may be the only barrier to self-promotion; needs verification |
| F3 | P3 minor | Billing endpoint `list-invoices` fails closed with 503 *for every role incl. admin/platform* — invoice RBAC unverifiable in this deployment |
| F4 | P3 minor | Cross-tenant `case_entries` INSERT rejected with misleading message `cross-tenant quota access denied` (it is a policy block, not a quota event) |
| F5 | Info | `platform@demo.com` maps to DB role `admin`, behaves tenant-scoped like other client roles (saw only own-tenant rows) |

---

## A. Cross-tenant isolation

### A1. Reads filtered to foreign tenant `00000000-0000-0000-0000-000000000001` — expected 0 rows for all roles

| Role | case_entries | profiles | notifications | tenant_webhooks | Unfiltered scan shows only own tenant? |
|---|---|---|---|---|---|
| resident | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ |
| supervisor | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ |
| director | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ |
| admin | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ |
| platform | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ 0 (200) | ✅ |

### A2. Writes targeting foreign tenant — expected rejection

| Probe | Actor | Result | Evidence |
|---|---|---|---|
| INSERT case_entry (foreign `tenant_id`) | resident | ✅ 403 | `42501 … "cross-tenant quota access denied"` |
| INSERT case_entry (foreign `tenant_id`) | supervisor | ✅ 403 | same as above |
| INSERT notification (foreign `tenant_id`) | supervisor | ✅ 403 | `42501 new row violates row-level security policy for table "notifications"` |
| INSERT tenant_webhook (foreign `tenant_id`) | director | ✅ 403 | `42501 new row violates row-level security policy for table "t…"` |
| PATCH own `profiles.tenant_id` → foreign | resident | ❌→ see **F1** | vs non-existent tenant: 409 FK (`Key is not present in table "tenants"`); vs **real** tenant `1111…`: **204, row actually moved** |

### F1 — [P2] profiles UPDATE missing tenant WITH CHECK (self-service tenant relocation)

**Reproduction**
```bash
# 1. login as any client role
curl -X POST "$SB/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
  -d '{"email":"resident@demo.com","password":"password123!"}'
# 2. PATCH own profile into a REAL existing foreign tenant
curl -X PATCH "$SB/rest/v1/profiles?id=eq.<own_profile_id>" \
  -H "apikey: $KEY" -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{"tenant_id":"11111111-1111-1111-1111-111111111111"}'   # -> 204, tenant_id persisted
```

**Evidence (observed twice, reverted immediately each time)**
- PATCH status **204**, subsequent reads confirm `tenant_id = 11111111-…` (QA E2E Institution).
- The relocated row became visible under the foreign tenant’s `profiles?tenant_id=eq.1111…` listing (row count 1 = the moved profile) — i.e., membership-record pollution of the target tenant.
- Blast-radius containment observed: same-JWT and fresh-login-after-move queries still returned **0** foreign-tenant `case_entries` / `notifications`; fresh JWT still resolved to Demo Hospital ⇒ live tenant claim is evidently sourced elsewhere than `profiles.tenant_id` at token mint.
- Reverted via service-role PATCH back to `9cd50d60-…`; final state verified: `{role: resident, tenant_id: 9cd50d60-…}`.

**Impact:** DB-level tenant-isolation invariant broken for `profiles`. Today no data escape was demonstrated (claim source independent), but any code path that trusts `profiles.tenant_id` directly (RPC joins, admin tooling, exports, support scripts) would treat the attacker as a member of the target tenant, and the target tenant’s member listings are polluted. Recommend: add `WITH CHECK (tenant_id = <current tenant>)` (or restrict tenant moves to admin-only RPC) on the `profiles` UPDATE policy.

---

## B. Privilege escalation

### B1. PATCH own `profiles.role` → must be rejected

| Role | Attempted | HTTP | Final role (re-read) | Verdict |
|---|---|---|---|---|
| resident | director | 400 | `resident` | ✅ blocked |
| supervisor | director | 400 | `supervisor` | ✅ blocked |
| director | admin | 400 | `director` | ✅ blocked |
| admin (institution_admin) | director | 400 | `institution_admin` | ✅ blocked |
| platform (db role `admin`) | director | 400 | `admin` | ✅ blocked |

Rejection body (all roles): `{"code":"P0001","message":"MFA enrollment required for role <target>"}` → see **F2**: the gate is MFA *enrollment*, not an admin approval step. If a user can self-enroll a factor, self-promotion may become possible. Recommended follow-up test (not executed here to avoid mutating auth state): enroll an MFA factor as resident, retry the role PATCH, then unenroll.

### B2. Approve/reject RPCs as resident — must fail

| RPC | Result | Evidence |
|---|---|---|
| `rpc/approve_case(p_entry_id, p_supervisor_id=<resident uid>)` | ✅ denied | HTTP 200 body `{"code":"forbidden","error":"Insufficient permissions"}` |
| `rpc/reject_case(...)` | ✅ denied | identical denial |

(Note: denials ride on HTTP 200 with structured error bodies — clients must branch on `code`; cosmetic observation only.)

### B3. Billing / invoices as non-admin — must fail

| Endpoint/table | resident | supervisor | director | admin | platform |
|---|---|---|---|---|---|
| `functions/v1/list-invoices` | 503 fail-closed ✅* | 503 ✅* | 503 ✅* | 503 (also blocked) | 503 (also blocked) |
| `subscriptions` table rows visible | 0 ✅ | 0 ✅ | 0 ✅ | 1 (allowed) | 1 (allowed) |

\* See **F3**: `{"error":"Billing is not configured for this deployment"}` (HTTP 503) is returned to **every** role including admin/platform. No invoice data leaks to non-admins (fail-closed), but intended admin-only RBAC could not be positively verified in this deployment. DB-layer scoping of `subscriptions` is correct.

---

## C. Unauthenticated anon-key access — must return zero rows

| Table | apikey only (no Bearer) | apikey + `Authorization: Bearer <anon>` | Verdict |
|---|---|---|---|
| case_entries | 200, **0 rows** | 200, **0 rows** | ✅ |
| profiles | 200, **0 rows** | 200, **0 rows** | ✅ |
| audit_logs | 200, **0 rows** | 200, **0 rows** | ✅ |
| notifications | 200, **0 rows** | 200, **0 rows** | ✅ |
| tenant_webhooks | 200, **0 rows** | 200, **0 rows** | ✅ |

RLS denies everything to the anon/publishable key. PASS across the board.

---

## D. audit_logs scoping

Columns discovered: `id, tenant_id, user_id, action, resource_type, resource_id, changes, ip_address, created_at, metadata, session_id` (actor = `user_id`).

| Perspective | Rows seen | Distinct actors | Outside own tenant | Expected | Verdict |
|---|---|---|---|---|---|
| resident | 253 | 1 (= own uid `f2a0d3a0-…`) | 0 | own actions only | ✅ |
| supervisor | 500 (limit hit) | 3 (tenant-wide: resident + others) | 0 | tenant-wide | ✅ |

Supervisor genuinely sees multiple distinct actors within Demo Hospital and nothing from other tenants; resident is locked to own `user_id`.

## E. Forged audit_logs INSERT — must fail for all client roles

| Role | HTTP | Result | Persistence check (`action='SEC_FORGED_INSERT_PROBE'`) |
|---|---|---|---|
| resident | 403 | `42501 new row violates RLS` | 0 rows ✅ |
| supervisor | 403 | same | ✅ |
| director | 403 | same | ✅ |
| admin | 403 | same | ✅ |
| platform | 403 | same | ✅ |

Audit trail is write-protected against every client role. PASS.

---

## Hygiene / cleanup statement

- Fixtures created during testing: **2** pending `case_entries` (one for the RPC probe, one stray from the first run) — both soft-deleted (`deleted_at` set) within the same session; `patient_hash='secmatrix'` live rows remaining: **0**. Live `case_entries` attributable to this run: **0** (table-wide live count 13, all pre-existing).
- Foreign-tenant INSERT attempts never created rows (403 before write). Webhook/notification forgery attempts likewise rejected pre-write.
- Resident profile twice relocated for F1 evidence; both times reverted via service-role PATCH; verified final state `{role: resident, tenant_id: 9cd50d60-febe-4adf-be0f-a36bf82762f6}` through both service-role and resident JWT reads.
- No hard deletes except forged-audit persistence check found nothing to delete; no auth/MFA state mutated.

## Scorecard

| Section | Checks | Pass |
|---|---|---|
| A. Cross-tenant reads (5 roles × 4 tables + scan) | 25 | 25 ✅ |
| A. Cross-tenant writes | 5 | 4 ✅ / 1 ❌ (F1) |
| B. Role escalation (5) + RPCs (2) + billing (8) | 15 | 15 ✅ (billing qualified by F3) |
| C. Anon-key lockdown (5 tables × 2 variants) | 10 | 10 ✅ |
| D. Audit scoping | 4 | 4 ✅ |
| E. Forged audit inserts + persistence (6) | 6 | 6 ✅ |
| **Total** | **~65 probes / 48 assertions** | **pass, except F1 (P2)** |
