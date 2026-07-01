# Launch-Readiness Gate — Phase 8

Status: **PRE-FLIGHT** (requires human sign-off on each item)

---

## 1. Security (HIGH)

| # | Check | Status | Evidence |
|---|---|---|---|
| S1 | All encryption keys rotated before go-live | ❌ PENDING | Migrations exist; run `supabase db reset` + trigger rotation |
| S2 | Sentry DSN configured with PHI scrubbing | ✅ DONE | All 3 configs have `scrubPhi()` in `beforeSend` (client/server/mobile) |
| S3 | Rate limiting enabled on all mutation endpoints | ✅ DONE | `checkRateLimit()` in: payment-gateway, ai-config, case-submit, approval(+5 more) |
| S4 | CSRF protection on all POST/PUT/DELETE endpoints | ✅ DONE | `validateOrigin()` in all API routes + edge functions |
| S5 | RLS enabled on all tables with row-level policies | ✅ DONE | `00049_force_rls_all_tables.sql` enforces across schema |
| S6 | Audit logs append-only (no UPDATE/DELETE possible) | ✅ DONE | `00051_audit_logs_append_only.sql` — trigger blocks mutations |
| S7 | Secrets redacted from audit log entries | ✅ DONE | `00050_redact_secrets_in_audit.sql` strips keys |
| S8 | PHI redacted from audit log entries | ✅ DONE | `audit_case_entry()` strips `patient_mrn`, `patient_dob` |
| S9 | Screenshot guard active on mobile | ✅ DONE | `usePreventScreenCapture()` in root layout |
| S10 | Biometric gate configured for sensitive operations | ✅ DONE | `biometric-gate.ts` wraps approval/sync actions |

## 2. Compliance (HIGH)

| # | Check | Status | Evidence |
|---|---|---|---|
| C1 | All state-changing operations write audit logs | ✅ DONE | Triggers cover: cases, profiles, tenants, subscriptions, payments, consent, approvals, attachments, configs, templates, goals, retention |
| C2 | Data retention policy configured | ✅ DONE | `enforce_data_retention()` daily via pg_cron |
| C3 | Data retention purge writes audit trail | ✅ DONE | `00065` added audit INSERT to purge function |
| C4 | Approval/denial of supervisor role audited | ✅ DONE | `profiles` trigger via `audit_table_change()` |
| C5 | All config changes audited (AI, payment, webhook) | ✅ DONE | `audit_config_change()` + generic trigger |
| C6 | Key rotation and salt rotation audited | ✅ DONE | `rotate_encryption_key()`, `rotate_mrn_salt()` both write audit |

## 3. Data Protection (HIGH)

| # | Check | Status | Evidence |
|---|---|---|---|
| D1 | Encryption-at-rest (pgcrypto + derived keys) | ✅ DONE | `encrypt_with_tenant_key()` in `00053` |
| D2 | Patient MRN salted hash, not plaintext | ✅ DONE | `hash_patient_mrn()` in `00001` |
| D3 | No patient_mrn/dob in error responses | ✅ DONE | All error messages sanitized (Phase 5 fixes) |
| D4 | No PHI in Sentry events | ✅ DONE | `scrubPhi()` strips patient_mrn/dob/hash/field_values |
| D5 | Rate limiting prevents brute-force on auth | ⚠️ PARTIAL | In-memory only; requires Redis for multi-instance |

## 4. Performance (MEDIUM)

| # | Check | Status | Evidence |
|---|---|---|---|
| P1 | Missing indexes added | ✅ DONE | `00066` adds `idx_profiles_tenant_role`, `idx_audit_logs_tenant_created`, `idx_approval_requests_tenant` |
| P2 | Orphaned materialized view removed | ✅ DONE | `case_stats_mv` + `refresh_case_stats_mv()` dropped in `00066` |
| P3 | pg_cron jobs scheduled | ✅ DONE | Retention purge (daily), AI cache cleanup (6hr) |
| P4 | Supervisor fetch limited | ✅ DONE | `submit/route.ts` now uses `.limit(50)` |
| P5 | No N+1 query patterns in hot path | ✅ DONE | Submit route: 7 sequential queries, 1 batch insert |

## 5. Monitoring & Observability (MEDIUM)

| # | Check | Status | Evidence |
|---|---|---|---|
| M1 | Sentry error tracking initialized | ✅ DONE | All 3 configs (web client, web server, mobile) |
| M2 | Sentry performance traces (10% sample) | ✅ DONE | `tracesSampleRate: 0.1` in all configs |
| M3 | Sentry session replays on error (100%) | ✅ DONE | `replaysOnErrorSampleRate: 1.0` |
| M4 | DenyUrls configured for sensitive routes | ❌ PENDING | Consider adding `/api/auth/*`, `/admin/*` patterns to denyUrls |
| M5 | Health check endpoint | ❌ NOT IMPLEMENTED | No `/api/health` or uptime-monitoring endpoint |

## 6. Deployment (MEDIUM)

| # | Check | Status | Evidence |
|---|---|---|---|
| E1 | Migration files sequential and non-overlapping | ✅ DONE | 66 migrations, no duplicate numbers, validated by CI |
| E2 | CI pipeline validates migrations | ✅ DONE | `.github/workflows/ci.yml` — duplicate-number check |
| E3 | CI runs typecheck | ✅ DONE | `pnpm -r typecheck` in CI |
| E4 | CI runs tests | ✅ DONE | `pnpm test` in CI (284 tests) |
| E5 | CI runs lint | ✅ DONE | `pnpm lint:all` (0 errors) |
| E6 | Build succeeds | ✅ DONE | `pnpm build:web` (30 routes) |
| E7 | Docker Desktop available for `supabase db reset` | ❌ BLOCKED | Not on this machine; requires human to run against real DB |

## 7. Testing Gaps (KNOWN)

| # | Gap | Severity | Mitigation |
|---|---|---|---|
| T1 | No E2E smoke tests | MEDIUM | Requires Playwright browser binaries |
| T2 | No k6 load tests | LOW | Requires k6 CLI |
| T3 | No SQL trigger tests | MEDIUM | Requires `supabase db reset` (Docker) |
| T4 | Edge function unit tests | LOW | Requires Supabase CLI local env |
| T5 | Coverage: `sync.ts` at 49.3% | MEDIUM | Critical offline-first module |
| T6 | Coverage: `auth.ts` (server) at 21.05% | MEDIUM | Requires mocking next/headers |

## 8. Known Findings Carried Forward

| # | Finding | Severity | File | Status |
|---|---|---|---|---|
| K1 | `tenant_webhooks.secret` stored in plaintext | MEDIUM | `00063_tenant_webhooks.sql` | Documented for remediation |
| K2 | Rate limiter is in-memory only | MEDIUM | `lib/rate-limit.ts` | Needs Redis for multi-instance |
| K3 | No connection pooling configuration | LOW | `lib/supabase/*.ts` | Supabase defaults apply |

---

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineering Lead | | | |
| Security Officer | | | |
| Compliance Officer | | | |
| Product Owner | | | |
