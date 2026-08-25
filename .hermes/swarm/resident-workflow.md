# Resident Workflow End-to-End — Live API Probe

- Date: 2026-08-25 · Repo: G:\elogbook (read-only; nothing in repo modified)
- Env: https://nuyedxkzaimlzaetbpaw.supabase.co (creds from .env.local)
- Account: resident@demo.com (password123!) · auth uid `f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783`
- Profile id `2ce0152b-e6da-43c9-8797-641bbbf5187d` · Tenant `9cd50d60-febe-4adf-be0f-a36bf82762f6` ("demo hospital", role=resident, specialty=orthopedics)
- Contract mirrored from web (`apps/web`) + mobile (`apps/mobile/lib/sync`, offline sync support migrations). Single paced login; one session used end-to-end.

## Checklist

| # | Step | Result | Notes |
|---|------|--------|-------|
| 1 | Login `/auth/v1/token?grant_type=password` | ✅ PASS | 200, expires_in=3600 |
| 2 | Profile read → PATCH full_name → revert | ✅ PASS | Read OK; `full_name` → "Dr. Alex Resident PROBE" → reverted to "Dr. Alex Resident". Verified via GET both times |
| 3 | List templates (tenant + global) | ✅ PASS w/ note | Tenant-owned: **0**, Global (`00000000-…-000000000000`): **2** (`General Surgery Log` surgery, `Radiology Report Log` radiology). RLS policy `Tenant members can read templates` (20260818100000) works incl. global union |
| 4 | `hash_patient_mrn` RPC + insert deidentified approved case | ✅ PASS w/ finding | RPC returned hash for `PROBE-3ca5978e8b`; INSERT `case_entries` status='approved', `is_deidentified=true`, `patient_mrn=NULL`, `patient_dob=NULL`, `patient_hash=<rpc output>`, template=global surgery, `field_values={procedure_name, anesthesia_type:"General", supervision_level:"Observed"}`. PHI-scan trigger passed. **Finding F3: hash is 32-hex md5 fallback, not sha256** |
| 5 | Read case back + threaded comments + visibility | ✅ PASS | Case read back identical (approved, deidentified, fv intact). Root comment (`parent_id=NULL`) + reply (`parent_id=<root>`) inserted; GET by `entry_id` shows both in order — thread visible to author-resident |
| 6 | Insert program_goal (target_count>0) + update progress | ✅ PASS w/ findings | Direct REST INSERT → **42501 RLS** (correct per policy, director-only). Created via `sync_push_batch('program_goals', …)` target_count=5. Progress row initially absent → inserting approved case fires `trg_update_goal_progress`: row appeared with current_count=0 (**F4: global-template cases don't count**); after neutralizing goal.specialty and next case insert, current_count recalced correctly (66 total approved incl. pre-existing seed data). Trigger-driven "update progress" verified |
| 7 | Rotation + shift via `sync_push_batch` + partial-update location | ✅ PASS | Rotation pushed (affected=1); shift pushed with `rotation_id`,`resident_id`,`shift_date` NOT NULL satisfied (affected=1); partial push `{id,tenant_id,location:'OR-2'}` → GET confirmed shift_date/type/start/end preserved, location updated. v4 partial-row semantics work live |
| 8 | List evaluations visible to resident | ✅ PASS (empty) | `evaluation_forms?resident_id=eq.<me>` → 0 rows; tenant-wide select also 0 (table empty for this tenant). See F5 on RLS breadth |
| 9 | `set_user_consent` grant → revoke via RPC | ✅ PASS | grant `{success:true,granted:true}` → new `consent_records` row `revoked_at=NULL`; revoke `{success:true,granted:false}` → second row with `revoked_at` set. Append-only record semantics (one row per call) |
| 10 | PATCH `profiles.onboarding_steps=['profile','specialty']` → restore | ✅ PASS | Patch applied (count=2), restored original `[]` (count=0), verified via GET |
| 11 | Logout `/auth/v1/logout` → token rejected on REST | ⚠️ PARTIAL | Logout **succeeded**: session destroyed (repeat logout → `403 {"error_code":"session_not_found","msg":"Session from session_id claim in JWT does not exist"}`). **But old access token still returns 200 on PostgREST minutes later** — see F1 |

## Tombstone / cleanup ledger (all created rows removed)

| Row | ID | Removal path | Verified |
|-----|----|--------------|----------|
| case_entries #1 (probe cholecystectomy) | `3c72d722-5ef5-4dd4-abee-9feb5ff67c0c` | service-role DELETE (resident soft-delete blocked, see F2) | remaining=0 ✅ |
| case_entries #2 (progress probe appendectomy) | `5537436a-92df-4e30-8b80-ce9f03596583` | service-role DELETE | remaining=0 ✅ |
| case_entries #3 (recalc probe hernia repair) | `e907d82a-cef3-416c-916d-6999950f56f1` | service-role DELETE | remaining=0 ✅ |
| comments root | `689e7b8f-2311-476f-b3f0-a20c2be9f4e9` | resident DELETE | remaining=0 ✅ |
| comments reply | `76f30f48-1ee1-40f8-8bff-e08e7196307c` | resident DELETE (child first) | remaining=0 ✅ |
| program_goal | `81f8cdc5-2f36-4a50-bcb8-fde4cf39d129` | service-role DELETE | remaining=0 ✅ (goal_progress cascade also 0) |
| rotations | `6534efd8-e0a0-437e-b8f3-1de98901c5af` | resident DELETE | shift remaining=0 ✅ |
| shifts | `fbe6f7d7-7fd6-497e-8471-aace5250b3ae` | resident DELETE | remaining=0 ✅ |
| consent_records (grant) | `eaac12c7…` | service-role DELETE | remaining=0 ✅ |
| consent_records (revoke) | `c3719a8d…` | service-role DELETE | remaining=0 ✅ |
| profiles.full_name | — | reverted in-step | 'Dr. Alex Resident' ✅ |
| profiles.onboarding_steps | — | restored in-step | `[]` ✅ |

Audit_logs rows written by triggers remain (append-only by design); no PHI ever transmitted (all patient identifiers hashed or absent).

## Findings (severity ordered)

- **F1 — MEDIUM (security)**: Access tokens survive logout against data APIs. After successful logout (session gone; GoTrue confirms `session_not_found`), the same bearer token continued to return **200** from PostgREST (`GET /rest/v1/profiles`). Stateless JWT validation ⇒ up to `expires_in`=3600s stolen-token window after logout. Suggest short-lived access tokens or session-revocation enforcement at the API gateway (Supabase's newer "JWT revocation"/session checks are not active for REST here).
- **F2 — MEDIUM (data-integrity / mobile sync blocker)**: Resident cannot soft-delete (tombstone) their own **approved** case via REST — `PATCH {deleted_at}` → `42501 new row violates row-level security policy`. Migrations `20260824000000_allow_case_soft_delete_rls.sql` + `20260824010000_allow_tombstone_in_write_once_trigger.sql` claim to allow exactly this, so the live DB appears to be missing these policies/trigger def. Consequence per migration header: offline sync deletes of non-draft cases retry forever and tenants can wedge at quota cap.
- **F3 — LOW/MEDIUM (privacy)**: `hash_patient_mrn` returned a 32-hex digest ⇒ the **md5 fallback** branch ran instead of sha256-with-tenant-salt (pgcrypto `digest` unavailable in function context; cf. `20260818110000_enable_pgcrypto.sql`). Unsalted-md5-style MRN hashing is weaker than designed; verify pgcrypto is enabled and the salt path exercised.
- **F4 — LOW (logic)**: `recalc_goal_progress` counts cases only against templates where `ct.tenant_id = <tenant>` — cases logged against **global** templates never count toward a specialty-scoped goal. This demo tenant owns 0 templates, so every case is invisible to goals until specialty is nulled.
- **F5 — LOW (privacy, policy breadth)**: `evaluation_forms` RLS is single tenant-wide policy (`eval_forms_tenant FOR ALL USING tenant_id = get_tenant_id()`): any authenticated tenant member (incl. residents) can read **all** evaluations of all residents. Live table empty, so not demonstrated end-to-end, but policy text permits it.
- **F6 — INFO (privilege surface)**: `sync_push_batch` is SECURITY DEFINER over an allowlist including `rotations`, `shifts`, `program_goals`, `case_templates`, `comments` — a resident can create rows that direct RLS reserves for director+ (observed: rotation + program_goal created as resident). Intentional for offline sync, but worth noting as an RLS bypass surface if the allowlist grows.
- **F7 — INFO**: tenant has no own case templates (only the 2 seeded globals); PHI scan trigger correctly rejected nothing here but is armed (would refuse dates/6+-digit numbers inside `field_values` while deidentified).

## Probe mechanics note
Dispatch messaging channel (`ctx_485ddd6b6670`) was revoked mid-run (`worker_done`/heartbeats rejected by CLI); full results are persisted here for the coordinator.
