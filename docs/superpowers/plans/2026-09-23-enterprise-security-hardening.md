# Enterprise Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the E-Logbook clinical multi-tenant system to a verifiable HIPAA-aware enterprise security baseline without relying on AI prompts or UI-only controls.

**Architecture:** Apply a staged containment → database identity/RLS → application perimeter → supply-chain/operations → compliance-evidence program. Security decisions are enforced in PostgreSQL, server-side route guards, authenticated service adapters, and blocking CI gates; every new migration is forward-only and every sensitive action is covered by negative tests.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres/Auth/Storage/Edge Functions (Deno), Zod, Vitest, pgTAP, GitHub Actions, pnpm, Docker/Caddy, existing `@elogbook/shared` and `@elogbook/ops` packages.

---

## File map

- **P0 containment:** `scripts/verify-release-containment.mjs`, `scripts/verify-secret-containment.mjs`, `.gitleaks.toml`, `.github/workflows/security.yml`, `docs/security/incidents/2026-09-23-service-role-exposure.md`.
- **Database:** new migrations under `supabase/migrations/20260923*.sql`; new pgTAP files under `supabase/tests/p1_*.sql`; migration/security gates under `scripts/`.
- **Identity/API:** `apps/web/lib/supabase/security-context.ts`, `session-revocation.ts`, `apps/web/lib/http/request-guard.ts`, `packages/shared/src/security/outbound-url.ts`, and guarded route handlers.
- **Uploads/AI:** attachment broker routes, `apps/web/lib/attachments/upload-policy.ts`, `supabase/functions/process-attachment/index.ts`, `supabase/functions/_shared/ai-guard.ts`.
- **Observability:** `apps/web/lib/observability/redact.ts`, `apps/web/lib/logger.ts`, Edge logging helper and Sentry configuration.
- **Mobile:** `apps/mobile/lib/capability.ts`, session/authorization/database adapters and native security verification.
- **Supply chain:** all `.github/workflows/*.yml`, Dockerfiles/Compose, Deno lock/import map, SBOM/provenance scripts.
- **Operations/compliance:** backup scripts/workflows, `docs/compliance/*`, `docs/security/*`, `SECURITY.md`.

Current worktree is intentionally dirty. Never use `reset`, `clean`, `checkout --`, broad stash, or revert unrelated files. Implementers must leave unrelated pre-existing changes intact and must not commit unless explicitly requested.

---

### Task 1: Establish local release containment and incident record

**Files:**
- Create: `scripts/verify-release-containment.mjs`
- Create: `docs/security/incidents/2026-09-23-service-role-exposure.md`
- Modify: `.github/workflows/cd.yml`, `.github/workflows/deploy-web.yml`, `.github/workflows/deploy-mobile.yml`

- [ ] **Step 1: Write the failing containment test**

Create `scripts/verify-release-containment.mjs` so it exits non-zero when a production deployment workflow can trigger on `push` to `main` or when setup/update/backup destructive routes are not explicitly marked isolated. The script must inspect workflow text only and never print secret values.

- [ ] **Step 2: Run it to verify the current tree fails**

Run: `node scripts/verify-release-containment.mjs`
Expected: non-zero with at least the current independent `push` production trigger identified.

- [ ] **Step 3: Add the incident record**

Record timeline, systems in scope, owner placeholders resolved by the operator before activation, credential classes affected, containment decision, and evidence links. Use `[REDACTED]` for every credential and do not copy local environment contents.

- [ ] **Step 4: Freeze independent production triggers**

Change production deployment workflows so they require an explicit protected workflow dispatch after the unified release gate. Do not remove staging or development jobs. Keep the current workflow syntax valid.

- [ ] **Step 5: Verify**

Run: `node scripts/verify-release-containment.mjs`
Expected: PASS.

---

### Task 2: Add blocking secret containment scanning

**Files:**
- Create: `.gitleaks.toml`
- Create: `scripts/verify-secret-containment.mjs`
- Modify: `.github/workflows/security.yml`, `.gitignore`

- [ ] **Step 1: Write the failing scanner test**

Add `tests/security/secret-containment.test.mjs` with fixtures for a service-role JWT, API-key assignment, and a nested Markdown secret. The scanner test must assert failure without returning the matched value.

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test tests/security/secret-containment.test.mjs`
Expected: FAIL because the scanner does not exist.

- [ ] **Step 3: Implement the scanner**

Scan tracked files and optionally local ignored files using `git ls-files`/`git grep`; detect Supabase JWT shapes, `SUPABASE_SERVICE_ROLE_KEY` assignments, provider key prefixes, private-key headers, and secret-bearing Markdown. Support `--history` for a redacted history scan. Print only file path, line number, rule name, and a hash prefix.

- [ ] **Step 4: Add CI and ignore rules**

Run the scanner in `security.yml` for pull requests and pushes to main. Add `SECURITY_ALERT_ENV_SECRETS.md` and generated secret reports to `.gitignore`; never add actual secrets to `.env.example`.

- [ ] **Step 5: Verify**

Run: `node --test tests/security/secret-containment.test.mjs` and `node scripts/verify-secret-containment.mjs`
Expected: tests pass; current known secret-bearing local files are reported as findings without values.

**External blocker:** authorized operators must rotate/revoke the Supabase key and dependent credentials. Local code cannot prove revocation.

---

### Task 3: Add database security regression suites before migrations

**Files:**
- Create: `supabase/tests/p1_16_catalog_invariants.sql`
- Create: `supabase/tests/p1_17_legacy_rpc_containment.sql`
- Create: `supabase/tests/p1_18_principal_status_rls.sql`
- Create: `supabase/tests/p1_19_audit_secret_idempotency.sql`
- Create: `supabase/tests/p1_20_attachment_authorization.sql`
- Create: `supabase/tests/p1_21_policy_convergence.sql`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add failing pgTAP assertions**

Cover: no `PUBLIC`/`anon` execution on legacy sync/backup functions; no unsafe definer search paths; every public table has RLS and FORCE RLS; anonymous and cross-tenant reads/writes fail; suspended user/tenant fails closed; audit payload excludes clinical values; operation IDs are tenant/actor scoped; quota counts reject negatives; attachment mutations require ownership/role and clean status.

- [ ] **Step 2: Run the suites against the current schema**

Run on a disposable local Supabase instance: `supabase db reset` then `supabase db test supabase/tests/p1_16_catalog_invariants.sql supabase/tests/p1_17_legacy_rpc_containment.sql supabase/tests/p1_18_principal_status_rls.sql supabase/tests/p1_19_audit_secret_idempotency.sql supabase/tests/p1_20_attachment_authorization.sql supabase/tests/p1_21_policy_convergence.sql`
Expected: failures identify the known legacy and policy gaps.

- [ ] **Step 3: Register tests in CI**

Add the six files to the maintained test inventory and fail if a security suite is removed or skipped.

---

### Task 4: Contain legacy RPCs and unsafe grants

**Files:**
- Create: `supabase/migrations/20260923000001_legacy_rpc_and_grant_containment.sql`

- [ ] **Step 1: Write the migration**

Drop `public.sync_pull_changes(text,uuid,timestamptz,integer)` and `public.sync_push_batch(text,jsonb)` if current mobile code has no callers. Revoke `PUBLIC`, `anon`, and `authenticated` execution before any drop. For every retained `SECURITY DEFINER` function, set `search_path = pg_catalog, public, pg_temp` and explicitly grant only reviewed roles.

- [ ] **Step 2: Run the legacy RPC tests**

Run: `supabase db test supabase/tests/p1_17_legacy_rpc_containment.sql`
Expected: PASS; `has_function_privilege` is false for public/anon/authenticated and the dropped signatures are absent.

- [ ] **Step 3: Commit only when explicitly requested**

Do not commit automatically in this plan execution unless the user asks for commits.

---

### Task 5: Add authoritative principal and tenant status helpers

**Files:**
- Create: `supabase/migrations/20260923000002_authoritative_principal_status.sql`
- Create: `apps/web/lib/supabase/security-context.ts`
- Create: `apps/web/lib/supabase/__tests__/security-context.test.ts`
- Modify: `apps/web/lib/supabase/require-admin.ts`, `apps/web/lib/supabase/require-platform-admin.ts`, `apps/web/lib/supabase/middleware.ts`

- [ ] **Step 1: Add fail-closed helper tests**

Test that a missing profile, missing tenant, suspended profile, suspended tenant, and AAL below the required level all deny. Test that the server obtains role/status from the database rather than request JSON or local flags.

- [ ] **Step 2: Implement SQL helpers**

Create `public.is_account_active()`, `public.is_tenant_active()`, and a pinned `SECURITY DEFINER` principal lookup. Return NULL/false for missing status; do not default an unknown account to active. Add `FORCE RLS` to current public tables that lack it.

- [ ] **Step 3: Implement the web security context**

Expose a typed `getSecurityContext()` that reads the authenticated Supabase session, profile status/role, tenant status/slug, and JWT AAL. Return a discriminated union `{ ok: true, context } | { ok: false, reason }`; privileged guards must fail closed.

- [ ] **Step 4: Verify**

Run targeted Vitest for the new context and existing admin/platform-admin tests, then the principal-status pgTAP suite.

---

### Task 6: Converge tenant and role RLS policies

**Files:**
- Create: `supabase/migrations/20260923000003_tenant_role_policy_convergence.sql`
- Modify: `supabase/migrations/20260812110000_harden_tenant_rpcs.sql` only through a new migration, never in place
- Modify: `supabase/tests/p1_18_principal_status_rls.sql`, `p1_21_policy_convergence.sql`

- [ ] **Step 1: Define the final policy matrix**

For each affected table, specify SELECT/INSERT/UPDATE/DELETE separately. Institution-admin access must include `tenant_id = get_tenant_id()` in both `USING` and `WITH CHECK`; global authority must use the platform-admin registry. Residents may access only their own clinical rows unless a documented supervisor workflow applies.

- [ ] **Step 2: Implement forward-only policy replacement**

Drop only the known broad policies and create operation-specific policies. Preserve legitimate workflows with tested owner/role predicates. Do not add a universal permissive policy to compensate for a missing predicate.

- [ ] **Step 3: Verify cross-tenant negatives**

Run pgTAP for profiles, subscriptions, settings, notifications, evaluations, rotations, shifts, milestones, comments, scholarly activity, dashboard/analytics RPCs, and duty-hour RPCs. Expected: every cross-tenant operation is denied.

---

### Task 7: Harden audit, secret storage, idempotency, quotas, and retention

**Files:**
- Create: `supabase/migrations/20260923000004_metadata_only_audit.sql`
- Create: `supabase/migrations/20260923000005_secret_idempotency_quota_guards.sql`
- Create: `scripts/rotate-tenant-secrets.mjs`
- Create: `tests/security/rotate-tenant-secrets.test.mjs`
- Modify: `supabase/migrations/00076_backup_schedule.sql` only through new forward migration logic

- [ ] **Step 1: Add failing tests**

Assert audit records contain IDs/action/changed-field names but not full `field_values`, patient names, email, MRN, DOB, or nested clinical JSON. Assert missing encryption keys fail closed, operation IDs are tenant/actor scoped, and quota counts are positive/bounded.

- [ ] **Step 2: Implement metadata-only audit**

Replace full-row serialization for clinical tables with an allowlist of identifiers and changed field names. Preserve append-only behavior and add `REVOKE TRUNCATE` plus a statement trigger where supported.

- [ ] **Step 3: Implement secret and quota guards**

Remove plaintext webhook-secret fallback, revoke backup functions from public roles, scope `op_id` by tenant/actor, and reject negative or unbounded quota arguments.

- [ ] **Step 4: Verify**

Run the new pgTAP suite and Node tests. Scan generated audit fixtures to ensure no PHI keys or values appear.

---

### Task 8: Add attachment quarantine and Storage authorization

**Files:**
- Create: `supabase/migrations/20260923000006_attachment_quarantine_storage.sql`
- Create: `apps/web/lib/attachments/upload-policy.ts`
- Create: `apps/web/app/api/[tenant]/attachments/upload/route.ts`
- Create: `apps/web/app/api/[tenant]/attachments/[id]/download/route.ts`
- Create: `apps/web/app/api/[tenant]/attachments/[id]/route.ts`
- Create: `supabase/functions/process-attachment/index.ts`
- Modify: `apps/web/components/CaseAttachments.tsx`, `supabase/functions/manifest.json`

- [ ] **Step 1: Add failing route/database tests**

Test unauthenticated access, wrong-tenant access, non-owner mutation, client MIME spoofing, oversized files, infected/quarantine downloads, and clean-owner downloads.

- [ ] **Step 2: Implement the broker contract**

Server route accepts bytes, checks size/count and case ownership, writes to private quarantine, and never trusts client MIME. The processor validates magic bytes, records scan state, and transitions only clean files to release. Ordinary clients receive no direct Storage insert/update/delete/remove permission.

- [ ] **Step 3: Replace the browser upload call**

Use the broker route from `CaseAttachments`; fail closed when scanning/encryption is unavailable. Preserve the existing component’s current local changes and add a static gate forbidding direct clinical `storage.upload/remove` calls.

- [ ] **Step 4: Verify**

Run route/component tests, Storage pgTAP, and `supabase functions list`/manifest validation. Expected: only clean authorized objects receive short-lived signed URLs.

**External decision:** choose and document the malware/document scanning engine and its data-handling/BAA posture.

---

### Task 9: Add shared request guards and SSRF policy

**Files:**
- Create: `packages/shared/src/security/outbound-url.ts`
- Create: `apps/web/lib/http/request-guard.ts`
- Create: `apps/web/lib/outbound-request.ts`
- Create: `supabase/functions/_shared/outbound-request.ts`
- Create: `apps/web/lib/http/__tests__/request-guard.test.ts`
- Create: `packages/shared/src/security/__tests__/outbound-url.test.ts`
- Modify: `apps/web/lib/webhooks.ts`, webhook routes, `supabase/functions/ai-insights/index.ts`, `supabase/functions/ai-quality/index.ts`, `apps/web/proxy.ts`
- Create: `scripts/verify-request-guards.mjs`

- [ ] **Step 1: Write failing policy tests**

Test rejection of `http`, localhost, `127.0.0.0/8`, RFC1918 ranges, link-local, metadata addresses, IPv4-mapped IPv6, alternate IP encodings, DNS rebinding, cross-host redirects, oversized responses, and unsafe request bodies.

- [ ] **Step 2: Implement shared policies**

Use strict Zod schemas and bounded reads. Resolve and validate DNS, connect through the approved egress path, disable redirects by default, strip sensitive headers on host changes, cap timeout/body/concurrency, and return only a status category to callers.

- [ ] **Step 3: Apply guards to mutations**

Add origin/content-type/body/schema/rate-limit guards to state-changing routes, with explicit signed-webhook and public-contact exemptions only where verified. Ensure every route has either the shared guard or a documented exemption checked by `verify-request-guards.mjs`.

- [ ] **Step 4: Verify**

Run targeted Vitest, webhook tests, and the static route-coverage gate. Expected: SSRF and oversized-response tests pass; all mutation routes are classified.

---

### Task 10: Enforce redirects, MFA, approval integrity, and AI boundaries

**Files:**
- Modify: `apps/web/lib/safe-redirect.ts`, MFA pages, auth callback, approval route, `apps/mobile/lib/capability.ts`, `apps/mobile/lib/authorization.ts`
- Create: `supabase/functions/_shared/ai-guard.ts`
- Create: `packages/shared/src/schemas/ai.ts`
- Create: `scripts/verify-agent-boundaries.mjs`

- [ ] **Step 1: Add failing tests**

Cover encoded/protocol-relative/javascript redirects, AAL1 access to privileged capabilities, stale approval domain failures, model output containing executable/unauthorized content, over-budget tool calls, and cross-tenant AI context.

- [ ] **Step 2: Implement controls**

Allow only known internal redirect prefixes; require server AAL2 for privileged operations; treat RPC `data.success !== true` as failure before side effects; validate model output before persistence/rendering; enforce de-identification, tenant scope, token/cost/fan-out budgets, and deterministic authorization at execution.

- [ ] **Step 3: Verify**

Run safe-redirect, MFA, approval, AI, and mobile capability tests. Expected: all malicious redirects, AAL1 privileged actions, stale approvals, and over-budget AI requests fail closed.

---

### Task 11: Restore PHI/secret observability redaction

**Files:**
- Create: `apps/web/lib/observability/redact.ts`
- Create: `apps/web/lib/observability/__tests__/redact.test.ts`
- Create: `supabase/functions/_shared/logging.ts`
- Modify: `apps/web/lib/logger.ts`, Sentry configs, `apps/web/instrumentation.ts`, Edge functions that log provider responses

- [ ] **Step 1: Add failing redaction tests**

Use nested objects/arrays, Error objects, URLs, request headers, Sentry contexts/tags/breadcrumbs, and AI provider responses containing email, MRN, DOB, names, tokens, and cookies. Assert the original values never appear in serialized output.

- [ ] **Step 2: Implement recursive allowlist redaction**

Redact by key and value class, cap depth/size, remove raw request/response bodies, and emit stable event IDs. Make external logging opt-in through an allowlisted endpoint governed by the outbound policy; do not send arbitrary `LOG_ENDPOINT` data.

- [ ] **Step 3: Verify**

Run logger/redaction/AI tests and a production-mode logger test. Expected: no PHI/secret value appears in console, Sentry, or external logger output.

---

### Task 12: Harden mobile authentication and local data

**Files:**
- Modify: `apps/mobile/lib/capability.ts`, `session.ts`, `authorization.ts`, `app/login.tsx`, `app/app.json`, `eas.json`, `db/database.ts`
- Create: `apps/mobile/lib/security/__tests__/mobile-security.test.ts`

- [ ] **Step 1: Add failing mobile tests**

Test AAL1 cannot access tenant-wide capabilities, missing status denies, demo credentials are absent in production, local clinical records are encrypted, and native network-security artifacts exist.

- [ ] **Step 2: Implement server-derived assurance**

Read AAL/status from the authenticated session/API; remove local `mfaVerifiedAt` as authorization evidence. Gate privileged sync/approval operations at AAL2 and fail closed on unknown tenant state.

- [ ] **Step 3: Implement or disable plaintext storage**

Use a reviewed SQLCipher-capable adapter and managed key flow, or remove the dormant plaintext path and block production qualification. Do not claim encryption without generated native evidence.

- [ ] **Step 4: Verify**

Run mobile typecheck/tests, Expo prebuild validation, and native security artifact checks.

---

### Task 13: Pin and lock supply-chain inputs

**Files:**
- Modify: all `.github/workflows/*.yml`, `apps/web/Dockerfile`, `docker-compose.yml`, `supabase/import_map.json`, Deno configs
- Create: `.github/dependabot.yml`
- Create: `scripts/verify-pinned-supply-chain.mjs`
- Create: `tests/security/pinned-supply-chain.test.mjs`

- [ ] **Step 1: Write the failing pin checker**

Detect non-40-character `uses:` refs, mutable scanner/base image tags, `npx --yes` unpinned tools, Deno `--no-lock`/`--no-check`, and missing `persist-credentials: false`.

- [ ] **Step 2: Pin approved versions/digests**

Use full action SHAs with update comments, image digests, exact tool versions, and a committed Deno lock. Preserve existing behavior; do not use floating `latest` for release inputs.

- [ ] **Step 3: Verify**

Run the checker, frozen install, and Deno checks. Expected: no mutable release input is reported.

---

### Task 14: Establish one protected promotion path and release evidence

**Files:**
- Create: `.github/workflows/release.yml`, `scripts/verify-single-release-path.mjs`, `scripts/generate-release-evidence.mjs`, `scripts/verify-release-evidence.mjs`
- Modify: `cd.yml`, `deploy-web.yml`, `deploy-mobile.yml`, `sbom.yml`, `container-scan.yml`, `dast.yml`

- [ ] **Step 1: Write the failing release-path gate**

Require all security jobs to be dependencies of production promotion, with no bypass environment variable and explicit staging approval. Verify all production deploy workflows are dispatch-only after the gate.

- [ ] **Step 2: Implement the workflow**

Run typecheck, tests, migration replay, SAST, secret scan, dependency audit, container/function scans, SBOM, staging smoke tests, and artifact verification before production. Set least-privilege permissions and OIDC only where required.

- [ ] **Step 3: Generate and verify evidence**

Produce CycloneDX inventories for pnpm, container, Deno, and mobile inputs; bind artifact digests to release commit/lockfiles; verify signed provenance/attestations before deploy.

- [ ] **Step 4: Verify**

Run the release-path/evidence scripts and a staging workflow dispatch. Production remains blocked until external GitHub environment protection is enabled.

---

### Task 15: Encrypt, externalize, and drill backups

**Files:**
- Modify: `scripts/backup-db.sh`, `scripts/backup-config.sh`, `.github/workflows/backup.yml`
- Create: `scripts/restore-db.sh`, `docs/operations/backup-drill.md`, `docs/upgrade/runbooks/restore.md`, `tests/security/backup-flow.test.mjs`

- [ ] **Step 1: Add failing backup tests**

Test that no database URL or secret appears in argv/logs, local-only output is not reported as durable success, checksums are verified, and restore refuses an untrusted artifact.

- [ ] **Step 2: Implement encrypted durable backup flow**

Use discrete connection settings plus `PGPASSFILE`, encrypt before upload, enforce restrictive permissions, upload to approved durable storage, verify remote checksum, and retain a manifest without secrets.

- [ ] **Implement restore drill**

Restore only into a disposable project/database, run RLS/audit/integrity checks, record RPO/RTO, and document rollback. Expected: a failed remote upload or checksum never reports success.

**External blocker:** approved object storage, KMS, retention, and BAA are required.

---

### Task 16: Build compliance evidence and operating cadence

**Files:**
- Create: `docs/compliance/hipaa-control-matrix.yaml`, `docs/compliance/vendor-register.yaml`, `docs/security/threat-model.md`, `docs/security/access-review.md`, `docs/security/retention-policy.md`, `docs/security/operating-cadence.md`, `docs/security/exception-register.yaml`
- Create: `scripts/verify-compliance-evidence.mjs`
- Modify: `SECURITY.md`, existing compliance docs

- [ ] **Step 1: Write the evidence validator**

Require each control to contain owner, implementation path, test/CI reference, evidence artifact, review date, BAA/vendor status, and exception expiry. Reject unsupported “HIPAA compliant”, “encrypted”, “SQLCipher”, or “signed” claims without evidence links.

- [ ] **Step 2: Create the matrix and registers**

Map technical safeguards, access management, audit controls, integrity, transmission security, contingency planning, vendor management, training, and incident response. Record unknown BAA status as `pending`, never `complete`.

- [ ] **Step 3: Add recurring cadence**

Document quarterly access/dependency/penetration/restore reviews, monthly control evidence checks, alert ownership, and exception expiry. Do not claim legal certification.

- [ ] **Step 4: Verify**

Run `node scripts/verify-compliance-evidence.mjs` and review every exception with an owner and expiry.

---

### Task 17: Full verification and release qualification

**Files:**
- No new source files unless a failing gate identifies a concrete defect.

- [ ] **Step 1: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 2: Run unit tests**

Run: `pnpm test`
Expected: PASS, including database/security suites where configured.

- [ ] **Step 3: Replay database and build**

Run: `supabase start && supabase db reset && supabase db test` on a disposable local stack, then `pnpm build:web` and mobile prebuild validation.
Expected: clean migration replay, passing tests, and successful builds.

- [ ] **Step 3: Run security/release gates**

Run all `scripts/verify-*.mjs` security gates, secret scan, dependency audit, SBOM/evidence verification, and staging E2E.
Expected: no critical/high findings, no unapproved mutable inputs, and successful artifact verification.

- [ ] **Step 4: Record residual risks**

Document external blockers (credential rotation, BAA/vendor approvals, GitHub environment protection, KMS/scanner/egress decisions) as owned exceptions. Do not claim completion until these are resolved or explicitly accepted by the user.

## External blockers and stop conditions

- Do not deploy or process real ePHI until the suspected Supabase service-role key is rotated and old access is proven invalid.
- Do not enable self-hosted or hosted PHI processing until BAAs/vendor eligibility and legal ownership are recorded.
- Do not weaken RLS, auth, CSRF, MFA, or upload controls to make tests pass.
- Stop and report a blocker if a migration would require editing deployed history, bypassing a failing security gate, using production data, or exposing a credential.

## Plan self-review

- Spec coverage: Phase 0 is Tasks 1–2; database identity/RLS is Tasks 3–7; uploads/app perimeter is Tasks 8–11; mobile is Task 12; supply chain/release is Tasks 13–14; backups/compliance is Tasks 15–16; final verification is Task 17.
- Placeholder scan: no implementation TODO/TBD markers; external decisions are explicit stop conditions, not omitted requirements.
- Type consistency: `SecurityContext`, `getSecurityContext()`, `outbound-url`, attachment lifecycle states, and audit action names are defined once and reused by later tasks.
- Safety: all database changes are new forward migrations; current dirty files are preserved; no task commits without explicit user instruction.
