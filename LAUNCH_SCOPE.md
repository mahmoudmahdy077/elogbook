# eLogbook Launch Scope — Release 1 (Pilot)

**Status:** ACCEPTED (Phase 0 gate). Supersedes any prior informal scope. Implementation pending per `PRODUCTION_UPGRADE_PLAN.md` v2.2.

**Date:** 2026-09-02
**Owner:** pilot steering (named: mahmoudmahdy077) — second approver required before PHI.

---

## 1. First jurisdiction & specialty

- **Jurisdiction:** Saudi Arabia — SCFHS framework (primary). ACGME/GMC field mappings retained in schema but no market claim until Phase 6 fixture validation.
- **Specialty(ies) for pilot:** General Surgery + Internal Medicine (two programs, one hospital). Chosen because they have the most complete SCFHS logbook templates in the current seed data; other specialties remain available but are not pilot-gated.
- **Open items gated to Phase 6:** WebADS export, Milestones half-level, duty-hour rule set — all marked `OPEN` in production plan and not pilot requirements.

## 2. Deployment topology

- **Pilot topology:** **single-process self-hosted** — one Next.js container behind Caddy on a single VM (Compose `app` + `caddy` on `elogbook` bridge). No horizontal scaling, no Swarm/K8s. External DB (Supabase self-hosted on same host via shared `supabase_default` network) is the only external dependency.
- **Rationale:** Minimizes blast radius for de-identified pilot, makes single-instance rate limiting appropriate (see §5), and lets Phase 2 evidence be produced on the exact topology that will run the pilot. Distributed topology is deferred until Phase 5 go/no-go and requires a separate readiness review.
- **Network:** Caddy terminates TLS (80/443) and is the **only** ingress. `app:3000` is **not** published to the host (see TICKET-008). Bootstrap/installer paths are absent from the PHI image (TICKET-004).

## 3. PHI permission for pilot

- **PHI in pilot: PROHIBITED.** De-identified data **required** (plan v2.2 change 9). No live patient identifiers, no MRN/DOB, no `patient_hash` derived from PHI. Pilot data set is synthetic or previously de-identified under `deidentified_no_phi` CHECK.
- **PHI may be introduced only after:** Phase 0-2 evidence archived, Phase 4 external security assessment (fixed scope + severity SLA), and executed BAA/DPA with Supabase + any AI/Sentry/PostHog sub-processor touching PHI. Until then `is_deidentified = true` + `patient_mrn IS NULL AND patient_dob IS NULL` is enforced by seed and by pilot onboarding checklist.

## 4. Supported roles & feature scope

- **Roles in scope:** `resident`, `supervisor`, `director`, `admin` (platform operator). `institution_admin` maps to `director` for pilot; SSO/SCIM configured but not required for login.
- **Features IN for pilot (web only):**
  - Case log CRUD, template-driven fields, per-field encryption, offline not required for pilot
  - Accreditation mapping (SCFHS) + gap analysis CSVs
  - Supervisor approval queue (`approve_case` / `reject_case` RPCs, AAL2 gated where MFA enrolled)
  - Audit trail, duty-hour entry, exports (CSV/PDF) de-identified
  - Tenant isolation with RLS `FORCE` + service-role integration tests (TICKET-007)
- **Explicitly OUT of pilot (Phase 6 or later):**
  - Mobile offline sync (WatermelonDB) — web-only pilot
  - Installer / setup wizard (`/api/setup/*`, `/api/backup*`, `/api/uninstall`, `/api/update/execute`) — absent from image
  - Push notifications & webhook dispatch on serverless (verified via `after()` but not pilot-required)
  - White-label self-serve payment, benchmark MV cron, EHR/FHIR, program-evaluation (PEC/APE), CCC packets, scheduling/leave, EPA entrustment

## 5. Rate-limit mode implied by topology

- **Mode:** `RATE_LIMIT_MODE=single-instance` (required enum in `packages/env` and `.env.example`, validated at boot via `instrumentation.ts`).
- **Why:** Single-process has no cross-instance state; Upstash is unnecessary and would be an extra availability dependency. Local per-process `Map` is the limiter. Credential keys capped at `min(maxRequests,5)` and **documented as reduced-security with no bound against distributed/header-rotating attacker** (Rule 5). Distributed mode is the later scaling path and requires `RATE_LIMIT_MODE=distributed` + Upstash credentials + Caddy `trusted_proxies` (TICKET-002).
- **Validation:** `NODE_ENV=production` without `RATE_LIMIT_MODE` → `instrumentation.ts:register()` throws and process exits non-zero before accepting traffic (Gate C). Same for `distributed` without Upstash creds. `single-instance` with creds present → creds ignored + one startup warning (contract row 7).

## 6. Exit criteria for this document (Phase 0)

- [x] Merged to `main`
- [ ] `RATE_LIMIT_MODE` in `packages/env/src/index.ts` Zod schema + `.env.example` (TICKET-001)
- [ ] `apps/web/instrumentation.ts` calls validator at boot (TICKET-001)
- [ ] Production boot with mode unset demonstrably exits non-zero (Gate C)

---

## 7. Falsifiability

- If a program requires mobile offline as a hard gate, this scope is wrong and must be re-issued with mobile in.
- If a hospital's infosec requires horizontal scaling from day 0, switch mode to `distributed` — but then TICKET-002/003/008 become pilot blockers, not Phase 5.
- If SCFHS case-log minimums require half-level milestones, `milestones.level INTEGER` must be migrated before any milestone export is claimed.
