# STAFF + ADMIN WORKFLOWS REPORT - task_2694bb5a2c7d

Date: 2026-08-25. Project: `nuyedxkzaimlzaetbpaw`. Tenant: `9cd50d60-febe-4adf-be0f-a36bf82762f6` (Demo Hospital).
Accounts (password123!): resident@demo.com / supervisor@demo.com / director@demo.com / admin@demo.com (institution_admin).
Method: direct Supabase REST + RPC probes via `node .hermes/swarm/staff-workflows.mjs`; logins paced ~3s apart.

## VERDICT

53 checks executed: 51 PASS, 2 FAIL (both tombstone attempts).

All missioned supervisor / director / admin workflows work end-to-end.

**FINDING F-STAFF-1 (P1): case_entries soft-delete (tombstone) is BROKEN on the live DB for BOTH resident and supervisor.**
PATCH `{deleted_at}` returns 403 / `42501 new row violates row-level security policy` even though migrations
`20260824000000`, `20260824030000`, `20260824040000` and `20260825010000_reassert_case_soft_delete_policies`
all claim to create matching permissive UPDATE policies ("residents soft delete own entries",
"supervisor+ soft delete tenant entries"). This is live-vs-migration policy drift - exactly the regression
that 20260825010000's header says it fixed ("Swarm Wave-1 finding F2"). That fix is not effective on live.
Impact: users cannot archive/delete their own cases through REST; sync-engine soft deletes fail too.
Cleanup of our two test rows was completed via service-role fallback (see TOMBSTONES).

## 1. SUPERVISOR WORKFLOWS - ALL PASS

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| S1 | resident inserts case status=pending | PASS | 201 id df2496a4-207a-4991-ac03-55676c9e4219 |
| S2 | rpc approve_case(entry_id, sup_uid, comment) | PASS | 200 {"success":true,"approval_id":"43bcae75-d9c4-4675-984a-9cf0733b8956"} |
| S3 | case status now approved | PASS | GET status=approved |
| S4a | approval notification inserted for resident (supervisor client) | PASS | 201 id 744f6455-4b59-4ae3-ac03-e6e7ea487ce1 |
| S4b | resident reads own notification | PASS | 200 title="Case approved", user_id=resident uid |
| S5a | resident inserts 2nd pending case | PASS | 201 id c5230a8b-ea0c-464e-87da-e53eec66d7bf |
| S5b | rpc reject_case with comment | PASS | 200 {"success":true,"approval_id":"7d8fe199-00c3-4336-9afe-1d1f9ba3a2c6"} |
| S5c | 2nd case status rejected | PASS | GET status=rejected |
| S5d | approval_requests row keeps comment verbatim | PASS | {"status":"rejected","comment":"Staff swarm rejection: needs more detail"} |
| S6a | cross-tenant case_templates INSERT denied | DENIED ok | 403 42501 RLS violation |
| S6b | cross-tenant case_entries INSERT denied | DENIED ok | 403 42501 "cross-tenant quota access denied" |
| S6c | cross-tenant SELECT isolated | PASS | 200, 0 rows |

Notes:
- approve_case/reject_case RPCs do NOT create notifications themselves. The Next.js route
  (`apps/web/app/api/[tenant]/approvals/action/route.ts:127`) inserts them app-side after the RPC;
  we verified that exact sequence works at DB level (supervisor insert -> resident read-back).
- Cross-tenant INSERT into case_entries is blocked earlier by the quota trigger's tenant check
  ("cross-tenant quota access denied") before RLS - defense in depth working.

## 2. DIRECTOR WORKFLOWS - ALL PASS

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| D1 | create program_goal | PASS | 201 id 9e65ec95-c6f8-4531-a325-a65f0f044c25 |
| D2 | update target_count 3->7 | PASS | 200 persisted |
| D3a | create case_template | PASS | 201 id c02db984-fff5-42e9-b42c-eb83b8691238 |
| D3b | update template name | PASS | 200 rename persisted |
| D4a | MSF evaluation_form created, default pending | PASS | 201 status=pending id fa4418bd-3626-4b71-ad0e-82f313845412 |
| D4b | pending -> completed (+overall_score 4.0) | PASS | 200 |
| D4c | completed -> acknowledged | PASS | 200 |
| D4d | invalid form_type 'bogus_type' | REJECTED ok | 400 23514 CHECK evaluation_forms_form_type check |
| D4e | invalid status 'approved' | REJECTED ok | 400 23514 CHECK evaluation_forms_status check |
| D5a | compliance data-access section query (audit_logs) | PASS | 200, 10 rows |
| D5b | phi-inventory counts (case_entries/profiles/consent_records) | PASS | cases=4 profiles=5 consents=0 |
| D5c | consent section query | PASS | 200, 0 rows |
| D5d | retention section query (soft-deleted) | PASS | 200, 0 rows |
| D6a | webhook register https://example.com/hook | PASS | 201 id c73dc3a5-1a7f-4421-9bdf-8068169c3eb2 |
| D6b | bad URL http://example.com/hook | REJECTED ok | 400 23514 chk_webhook_https_url |
| D6c | credential-bearing https://user:pass@example.com/hook | REJECTED ok | 400 23514 chk_webhook_no_credentials |

Compliance export sections mirror `apps/web/app/api/[tenant]/compliance/export/route.ts`
(roles director/institution_admin/admin only); all four underlying tenant-scoped queries run clean as director.

## 3. ADMIN WORKFLOWS - ALL PASS

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| A1 | profiles list tenant-scoped | PASS | 200, 5 rows, every row tenant_id = demo tenant |
| A2a | role change resident -> supervisor | PASS | 200 PATCH profiles.role=supervisor |
| A2b | REVERT to resident | PASS | 200 role=resident confirmed |
| A3 | tenant_settings read | PASS | 200, 0 rows (none configured for tenant yet) |
| A4a | sso_configs read | PASS | 200, 0 rows |
| A4b | sso_configs read-only enforced (INSERT as institution_admin) | DENIED ok | 403 42501 RLS (writes are platform-admin-only by design, migration 00058) |
| A5a | plan features readable | PASS | plans: free, individual-premium, institution-basic, institution-pro, institution-enterprise |
| A5b | custom_plan_features readable | PASS | 200, 0 rows |

Role change path used the "Supervisor+ can update resident profiles in tenant" UPDATE policy
(tenant WITH CHECK guard from 20260825000000). Resident profile left back at role=resident.

## 4. EDGE FUNCTIONS SWEEP - ALL FAST, NO HANGS

POST {} with anon key, each returned >=400 quickly (<3s requirement met):

| Function | Elapsed | Status | Response |
|---|---|---|---|
| payment-webhook | 235ms | 400 | {"error":"Missing stripe-signature header"} |
| create-checkout | 345ms | 401 | {"error":"Invalid or expired token"} |
| create-portal-session | 339ms | 401 | {"error":"Invalid or expired token"} |
| list-invoices | 248ms | 405 | {"error":"Method not allowed"} (GET-only endpoint) |
| ai-quality | 275ms | 401 | {"error":"Invalid or expired token"} |
| generate-pdf | 1019ms | 401 | {"error":"Invalid or expired token"} |

No timeouts, no 5xx, no hangs. Unauthenticated callers are rejected fast.

## TOMBSTONES / CLEANUP

| Row | Method | Result |
|---|---|---|
| notification 744f6455 (resident own) | DELETE as resident | 204 |
| program_goal 9e65ec95 | DELETE as director | 204 |
| evaluation_form fa4418bd | DELETE as director | 204 |
| case_template c02db984 | DELETE as director | 204 |
| tenant_webhook c73dc3a5 | DELETE as director | 204 |
| case df2496a4 (approved) | SOFT DELETE deleted_at set | service-role fallback (user-path broken, see F-STAFF-1); final state status=approved deleted_at=2026-08-25T00:48:39Z |
| case c5230a8b (rejected) | SOFT DELETE deleted_at set | service-role fallback; final state status=rejected deleted_at=2026-08-25T00:48:39Z |

Post-cleanup sweep (service role): templates like *Swarm* = 0, goals = 0, webhooks in tenant = 0,
eval forms = 0, notifications = 0, admin probe profile reverted to resident. Nothing left behind.

## SECONDARY OBSERVATIONS (no action taken)

1. Leftover debug artifacts from a previous swarm cycle exist in migrations
   (`20260825040000_temp_debug_introspect.sql`, `_swarm_debug_results` table, `debug_swarm_introspect()` RPC).
   The RPC is itself broken at runtime ("cannot set parameter \"role\" within security-definer function")
   because it calls set_config('role') inside a SECURITY DEFINER function. Cleanup candidate.
2. One transient Cloudflare 1101 "Worker threw exception" page appeared on a single PostgREST verify call;
   immediate retry succeeded. Isolated blip, no repro.
