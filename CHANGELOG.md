# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Launch v3] — 2026-08-12

Implemented per `docs/LAUNCH_UPGRADE_PLAN.md` (audit IDs in parentheses).

### Security
- **S1** — Role-gated the `secret_ai_config`, `secret_payment_gateway_config`, and `secret_tenant_webhooks` views: residents can no longer read tenant API keys / webhook secrets; edge functions (`ai-insights`, `ai-quality`, `create-checkout`, `payment-webhook`) read configs via the service client with `decrypt_with_version`.
- **S2/D4** — Tenant-validated `get_dashboard_data`, `get_template_usage_counts`, `check_case_quota`; caller-supplied `p_role` no longer trusted; `check_case_quota` revoked from PUBLIC.
- **S3** — Bound `duty_periods` and `faculty_evaluations` RLS to the caller's tenant; fixed `profiles.id = auth.uid()` write bug.
- **S4** — Dropped the broken institutions audit trigger; fixed `audit_program_goals` FK mismatch and DELETE branch.
- **S5** — `notifications` INSERT policy now prevents spoofing other users.
- **S6/D1/D2** — Payment webhook resolves tenants via `metadata.tenant_id` (no more nonexistent `stripe_account_id` column), subscription upsert no longer targets the dropped `UNIQUE(tenant_id)`, `payments.status` uses `'completed'`, failures recorded via `mark_stripe_event_failed`.
- **S7** — `list-invoices` verifies the requested customer belongs to the caller's subscription.
- **S8** — AI quota consumption is atomic (`consume_ai_quota`) with `release_ai_quota` on provider failure.
- **S9** — PDF/WebADS export audit rows now written via service role (were silently dropped).
- **S10** — CSV exports use a shared `escapeCsvCell` (formula-injection neutralized); audit HTML export escaped.
- **S11** — `/api/contact` now validates, rate-limits, and stores submissions (`contact_submissions`).
- **S12** — `enforce_data_retention` rewritten against the real schema with per-tenant audit rows.
- **S13** — `ai-gap-analysis` uses the shared origin allow-list CORS.
- **S14** — Mobile de-identified case list shows `patient_hash`, not a raw MRN slice.
- **D3** — Admin page no longer selects the dropped `encrypted_api_key`/`encrypted_secret_key` columns.

### Performance
- **P1** — Dashboard per-resident counts computed in SQL (`resident_counts` in `get_dashboard_data`).
- **P2** — Analytics aggregation moved to `get_analytics_data` (monthly volume, specialty, approval rate, supervisor workload).
- **P3** — Report counts moved to `get_report_counts`.
- **P4** — PHI inventory counts exclude soft-deleted rows.

### Features
- **Offline queue** — New-case submissions failing on network errors are encrypted (AES-256-CBC, SecureStore key) and queued; flushed on reconnect/foreground. "Saved Offline" is now honest.
- **Push notifications** — `push_tokens` table + mobile Expo push registration + web dispatchers on approval and submit; unified tap/cold-start navigation.
- **AI GA** — `ai-insights` quota gating fixed; unit tests for `sanitizeQuery`/`checkSafety`.

### Mobile fixes
- **M1** duty-hours `resident_id` (was undefined), **M2** approve/reject now pass `p_supervisor_id`, **M3** biometric opt-in preserved across logins, **M5** server-salted `patient_hash` computed on submit (de-identified cases may omit it), **M6** profile id from `app_metadata.profile_id`, **M7** no more intentional startup throw.

### Chore
- Dead code removed (allow-list from the plan); placeholder Sentry DSN and hardcoded Supabase keys stripped from build config; conservative auth session timeout.

## [Unreleased]

### Security
- **P7.0** — Added CycloneDX SBOM generation to CI (`.github/workflows/sbom.yml`); SBOM is attached to every GitHub release tag (`v*`) and uploaded as a 90-day artifact.
- **P0.1** — Redacted live Supabase project ID and anon key from committed documentation (`PROJECT_ANALYSIS.md`, `specs/_archive/*`).
- **P0.2** — Closed open-redirect in `/login` and `/auth/callback` via `safeRelativePath()` (10 unit tests).
- **P0.3** — Added CSRF (`validateOrigin`), per-user rate-limit, and ownership check (`entry.resident_id === profile.id`) to `/cases/[id]/submit`.
- **P0.4** — Added CSRF validation to `/api/[tenant]/admin/payment-gateway`; switched rate-limit key from per-tenant to per-user.
- **P0.5** — Fixed `approve_case` / `reject_case` to include `tenant_id` in INSERT into `approval_requests` (was raising NOT NULL violation). Supervisor approvals now actually work.
- **P0.6** — Applied `FORCE ROW LEVEL SECURITY` to all 24 tenant-scoped tables. RLS now applies even to the table owner; `service_role` retains `BYPASSRLS` via Postgres role default.
- **P0.7** — `audit_config_change` trigger now strips encrypted/secret columns before writing to `audit_logs.changes`. Plaintext API keys no longer leak into the audit trail.
- **P0.8** — `audit_logs` is now append-only: `REVOKE UPDATE, DELETE` + BEFORE UPDATE/DELETE trigger that raises an exception. Tamper-evident.
- **P0.9** — Fixed mobile `log-case.tsx` compile errors (undefined `selectedTemplateId`/`setSelectedTemplateId`/`step`/`setStep`).
- **P0.10** — Wired `syncService.setTenantId()` from the auth state listener. Offline sync now actually runs.
- **P0.11** — Replaced non-deterministic DJB2 `generatePatientHash` with `expo-crypto` SHA-256 (7 unit tests).
- **P0.12** — Documented PHI non-persistence invariant in `CaseForm.tsx`. No `localStorage` autosave exists today.

### Added
- `apps/web/lib/safe-redirect.ts` — open-redirect-safe `?next=` validator.
- `apps/web/lib/csrf.ts` — `validateOrigin()` for state-changing requests.
- `apps/mobile/lib/patient-hash.ts` — SHA-256 `hashPatientIdentifier()`.
- `ENTERPRISE_TRANSFORMATION_PLAN.md` — canonical 139-task transformation plan.

### Fixed
- 13 commits to address the 12 showstopper findings from the brutal audit.

## [v3.0.0] — 2026-06-24
- (See commit history — prior baseline release before this transformation began.)
