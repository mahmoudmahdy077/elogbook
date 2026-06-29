# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
