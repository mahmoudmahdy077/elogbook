# E-Logbook Enterprise Transformation Plan v3

**Generated:** 2026-06-24  
**Scope:** Deep audit remediation — 6-agent parallel audit of security, database, web frontend, mobile app, shared package, and infrastructure  
**Target:** Production-ready medical logbook handling PHI  

> ⚠️ **CRITICAL**: This application handles Protected Health Information (PHI). Every 🔴 CRITICAL issue in this plan blocks production deployment. Every 🟠 HIGH issue represents a real security or data integrity risk.

---

## Architecture Overview

See v2 plan (`specs/002-enterprise-transformation-v2/plan.md`) for full ASCII architecture diagrams. Same monorepo structure:

```
elogbook/
├── apps/
│   ├── web/          (Next.js 16 + Tailwind v4)  — 30+ pages, API routes
│   └── mobile/       (Expo 56 + RN 0.85 + WatermelonDB) — 10+ screens, offline-first
├── packages/
│   └── shared/       (TypeScript + Zod 4) — 22 Zod schemas, types, design tokens
└── supabase/
    ├── functions/    (4 edge functions: ai-insights, generate-pdf, payment-webhook, create-checkout)
    └── migrations/   (31 migrations, 22+ tables, 80+ RLS policies)
```

### Data Flow
- Web: HTTP/HTTPS → Supabase (direct client queries + edge functions)
- Mobile: Offline/Online sync via WatermelonDB → Supabase
- Auth: Magic Link / Password → Supabase Auth → JWT → RLS

---

## What Was Already Fixed

### v1 (67 tasks — 5 phases)
✅ **Phase 1 — Critical Security**: Auth bypass, consent RLS, `search_path` on SECURITY DEFINER functions, `hash_patient_mrn` STABLE, stripe_events table  
✅ **Phase 2 — High Severity**: Dead components deleted, CaseForm fixes, CSP/HSTS, SSRF protection, rate limiting, PDF ownership, CORS, tailwind config  
✅ **Phase 3 — Medium Severity**: Typed casts, shared types, Zod fixes, component defaults, dashboard dedup/UTC, clinicalTokens, batch WatermelonDB writes  
✅ **Phase 4 — Build/CI/CD**: Vitest, GHA CI, Dockerfile, ESLint, Supabase config, production app.json  
✅ **Phase 5 — Polish**: Constants, light mode CSS, bundle analyzer, memoization, DESIGN.md, migration rollback  

### v2 (46 of 47 tasks executed — 10 phases)
✅ **Phase 2 — Critical Security**: SSRF async fix in ai-insights (T-101), stripe_events RLS fix (T-102), ai_response_cache RLS (T-103), import_map.json (T-104), generate-pdf PHI filter (T-105)  
✅ **Phase 3 — Database/Schema**: Tenant isolation on 3 tables (T-106), CHECK constraints + indexes (T-107), CaseAttachment audit fields (T-108), ProgramGoal timestamps (T-109), Institution.tier type fix (T-110)  
✅ **Phase 4 — Edge Functions**: DB-backed rate limiting (T-111), payment-webhook caching (T-112), export-pdf timeout + error handling (T-113), create-checkout rate limiting (T-114)  
✅ **Phase 5 — Mobile App**: Hardcoded creds removed from app.json (T-115), test framework (T-116), stale closure fix (T-117), validation error display (T-118), dead code removal (T-119), NetInfo null handling (T-120), offline case-detail (T-121), hardcoded FK names (T-122)  
✅ **Phase 6 — Web App**: CSP nonce (T-123), N+1 query fix (T-124), unsafe casts reduced (T-125), submit route error handling (T-126), duplicate CSS removed (T-127), duplicate component removed (T-128)  
✅ **Phase 7 — Shared Package**: CaseTemplate schema refine (T-129), patient_hash min length (T-130), inviteUserSchema alignment (T-131), clinicalColors removal (T-132), design-tokens.config.js deletion (T-133), ProgressRing visual fix (T-134), StatusBadge visual fix (T-135)  
✅ **Phase 8 — Build/CI/CD**: CI migration validation (T-136), .dockerignore (T-137), pnpm pin (T-138), root tsconfig (T-139), root typecheck script (T-140)  
✅ **Phase 9 — Testing**: 3 new tests for required_fields/invite schema/mobile smoke (T-141–T-143)  
✅ **Phase 10 — UI/UX Polish**: Sync banner color parsing (T-144), hardcoded color fix (T-145), X-Content-Type-Options confirmed (T-147)  
⏭️ **T-146 skipped**: Native date picker — requires `expo-date-time-picker` install + interactive testing

---

## v3: Current State Assessment

A 6-agent deep audit was conducted after v2 execution, analyzing security, database/web/mobile code, shared package types, and infrastructure. The audit found **~150+ remaining issues** across all areas. This plan consolidates them into **34 actionable tasks** across 5 phases.

### Key Findings by Area

| Area | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| **Security** | 3 | 5 | 4 | 2 | 14 |
| **Database/Backend** | 1 | 2 | 3 | 1 | 7 |
| **Web Frontend** | 1 | 1 | 4 | 2 | 8 |
| **Mobile App** | 1 | 2 | 3 | 1 | 7 |
| **Shared Package** | 0 | 0 | 1 | 0 | 1 |
| **Infra/CI/CD** | 0 | 2 | 3 | 2 | 7 |
| **Total** | **6** | **12** | **18** | **8** | **34** |

---

## Issue Severity Legend

| Icon | Label | Description |
|------|-------|-------------|
| 🔴 | CRITICAL | Data loss, PHI exposure, privilege escalation, or app crash at startup |
| 🟠 | HIGH | Security gap, data integrity risk, missing auth/access control, major UX failure |
| 🟡 | MEDIUM | Code quality, performance, missing tests, maintainability debt |
| 🔵 | LOW | Polish, docs, cleanup, nice-to-have |

---

## Execution Instructions

1. **Start from Phase 1** and proceed sequentially through Phase 5
2. **Run `pnpm typecheck` after EVERY single task** — all 3 packages must typecheck with 0 errors
3. **Read the "Double-Check" section** of each task before marking it done — these contain edge cases and gotchas
4. **Do NOT skip phases** — Phase 1 fixes critical runtime/security bugs; later phases depend on stable foundations
5. **When modifying database migration files**: never modify existing migrations. Create new incremental SQL files
6. **When deleting dead code**: search all 3 packages for imports before removing exports
7. **When adding RLS policies**: test with both authenticated and anonymous roles
8. **Task numbering**: T-201 onward (continuation from v2's T-147)

---

## Phase 1: Critical Security & Runtime (8 tasks)

### T-201: Fix Prompt Injection in `ai-insights` Edge Function

- **Files**: `G:\elogbook\supabase\functions\ai-insights\index.ts`
- **Severity**: 🔴 CRITICAL — Security

**What to do**: The function constructs LLM prompts by directly interpolating the user's `query` parameter with template literals. This is a prompt injection vector. Add an input sanitization layer that:
1. Allow-lists safe characters only (alphanumeric, spaces, basic punctuation)
2. Strips any characters that could break out of the prompt context (`{`, `}`, `<`, `>`, `|`, backticks, shell metacharacters)
3. Caps query length at 1000 characters
4. Logs sanitized queries to `ai_query_logs` for audit

**Verification**: Read the file to confirm sanitization exists before prompt construction is called. `pnpm typecheck` passes.

**Double-Check**: Don't just strip HTML entities — use a proper allow-list regex. The LLM prompt template itself should also be reviewed for injection points.

---

### T-202: Fix PDF Generation — HTML → Actual PDF

- **Files**: `G:\elogbook\supabase\functions\generate-pdf\index.ts`
- **Severity**: 🔴 CRITICAL — Data Integrity

**What to do**: The function returns `Content-Type: text/html` with HTML content instead of `application/pdf` with actual PDF bytes. The core export feature is broken. Options:
1. Use a Deno-compatible PDF library (e.g., `@pdf-lib/pdf-lib` for Deno, or `jsPDF` via npm)
2. OR integrate with a PDF rendering service
3. Update content-type to `application/pdf`
4. Ensure binary response encoding is correct

**Verification**: The function should return actual binary PDF content with correct `Content-Type` header.

**Double-Check**: Deno edge functions have limited library support. If no Deno-compatible PDF library exists, consider generating HTML and using a headless conversion API, or switching the export route to use the web app's server-side rendering.

---

### T-203: Rename `proxy.ts` → `middleware.ts` for Web App

- **Files**: `G:\elogbook\apps\web\proxy.ts` → `G:\elogbook\apps\web\middleware.ts`
- **Severity**: 🔴 CRITICAL — Security

**What to do**: Next.js middleware MUST be named `middleware.ts` at the app root (or `src/middleware.ts`). The current file is named `proxy.ts`, which means Next.js never loads it. Auth checks for protected routes are not running. Fix:
1. Rename `proxy.ts` to `middleware.ts`
2. Check that the `config.matcher` includes all protected routes
3. Ensure the middleware exports `default` or `middleware` function as Next.js expects

**Verification**: `pnpm typecheck` passes. Read the file to confirm it's at `middleware.ts` with correct exports.

**Double-Check**: Update any references in tsconfig or other config files if they reference `proxy.ts` specifically. Check that the matcher config is correct for the app's route structure.

---

### T-204: Install Font Assets for Mobile App

- **Files**: `G:\elogbook\apps\mobile\assets\fonts\`
- **Severity**: 🔴 CRITICAL — Runtime

**What to do**: The `assets/fonts/` directory contains only `README.md` — no actual font `.ttf` files. The app's `_layout.tsx` calls `useFonts()` which will throw at startup. Fix:
1. Install the Inter font family via `expo-font`: `npx expo install @expo-google-fonts/inter`
2. OR download the 8 required font variants and place them in `assets/fonts/`
3. Update `_layout.tsx` to use the correct font loading approach
4. Verify in `app.json` that fonts are listed in `expo.assets`

**Verification**: Font files exist in `assets/fonts/`. `pnpm typecheck` passes.

**Double-Check**: The `useFonts` call in `_layout.tsx` lists 8 specific font weights — make sure all 8 are provided. Expo Go may handle fonts differently than a production build.

---

### T-205: Fix CSP Nonce Script Handling

- **Files**: `G:\elogbook\apps\web\app\layout.tsx`, `G:\elogbook\apps\web\middleware.ts` (after T-203)
- **Severity**: 🟠 HIGH — Security

**What to do**: The CSP header was hardened in T-123 but `script-src 'unsafe-inline'` may still be present in production. Fix:
1. Add nonce generation in middleware (crypto.randomUUID() per request)
2. Pass nonce via response header and `x-nonce` cookie or `csp-nonce` header
3. In `layout.tsx`, read the nonce and apply it to inline `<script>` tags
4. Remove `'unsafe-inline'` from `script-src` in production

**Verification**: Production build CSP header contains `'nonce-<random>'` without `'unsafe-inline'`.

**Double-Check**: Third-party scripts (analytics, error tracking) must either support nonce or use `'strict-dynamic'`. Next.js App Router with nonce requires careful integration with `next/script`.

---

### T-206: Remove `.env` Files from Git Tracking

- **Files**: `G:\elogbook\.env.local`, `G:\elogbook\apps\web\.env.local`, `G:\elogbook\apps\mobile\.env`
- **Severity**: 🟠 HIGH — Security

**What to do**: These files contain live Supabase credentials (anon key + project URL). They are currently tracked in git. Fix:
1. `git rm --cached` each file
2. Create `.env.example` files with placeholder values
3. Ensure `.gitignore` contains `*.local` entries
4. Add a comment in the repo README or AGENTS.md about local setup

**Verification**: `git status` shows the `.env*` files as untracked (not modified/deleted in staging).

**Double-Check**: The Supabase anon key should be rotated if any commits with these credentials were pushed to a public remote. Check `git log --all -p` for any pushed occurrences.

---

### T-207: Add Rate Limiting to Next.js API Routes

- **Files**: `G:\elogbook\apps\web\app\api\`
- **Severity**: 🟠 HIGH — Security

**What to do**: API routes have no rate limiting (only Supabase edge functions were rate-limited in v2). Fix:
1. Add a lightweight in-memory rate limiter to web API routes
2. Or use Upstash/Vercel KV for distributed rate limiting
3. Apply at minimum to auth endpoints and submission endpoints
4. Return 429 with `Retry-After` header

**Verification**: Accessing an API route rapidly returns 429 after threshold.

**Double-Check**: In-memory rate limiting doesn't work across multiple instances (serverless). For production, use a DB-backed or external KV-store approach. Consider `@upstash/ratelimit` for Vercel deployments.

---

### T-208: Fix Loose CORS in Edge Functions

- **Files**: `G:\elogbook\supabase\functions\*/index.ts` (all 4 edge functions)
- **Severity**: 🟠 HIGH — Security

**What to do**: All edge functions currently use `Access-Control-Allow-Origin: *` or mirror the request Origin without validation. Fix:
1. Set `Access-Control-Allow-Origin` to the specific deployment origin(s)
2. Validate the `Origin` header against an allow-list
3. Block requests with unexpected origins at the CORS preflight level

**Verification**: Test with curl using a non-allowed Origin header — must return CORS error.

**Double-Check**: Local development needs `http://localhost:3000` and `http://localhost:8081` allowed. Production needs the deployed URLs. Use an environment variable for the allowed origins list.

---

## Phase 2: Data Integrity & Correctness (7 tasks)

### T-209: Fix `StripeEvent` Type — Wrong Field Names

- **Files**: `G:\elogbook\packages\shared\src\types\database.ts`
- **Severity**: 🔴 CRITICAL — Data Integrity

**What to do**: The `StripeEvent` interface has `type` and `status` fields, but the actual `stripe_events` DB table has `event_type` (not `type`) and `processed` (not `status` — there is no `status` column at all). Fix:
1. Change `type` → `event_type` (string)
2. Remove `status` (no such column)
3. Add `processed: boolean` (default false in DB)
4. Search all consumers of `StripeEvent` across all 3 packages and update their usage

**Verification**: `pnpm typecheck` passes. Verify against the actual DB schema in migration files.

**Double-Check**: There may be code that references `event.type` or `event.status` — grep for `\.type\b` and `\.status\b` in files that import `StripeEvent`. Also check `payment-webhook` edge function and any API routes that handle Stripe events.

---

### T-210: Fix Mobile `patient_hash` Default (Empty String)

- **Files**: `G:\elogbook\apps\mobile\app\(tabs)\log-case.tsx`
- **Severity**: 🟠 HIGH — Data Integrity

**What to do**: The case form sends `patient_hash: ''` as default. The Zod schema `.min(1)` (added in T-130) rejects empty strings, breaking de-identified case submission. Fix:
1. Generate a proper SHA-256 hash from patient identifying fields
2. OR use a UUID as a temporary hash for cases where patient identity is collected separately
3. Import and use `@noble/hashes/sha256` or built-in `crypto.subtle.digest` (React Native compatible)
4. Ensure the hash is deterministic for the same patient (repeated submissions produce same hash)

**Verification**: Submitting a case with patient data successfully generates a non-empty `patient_hash` that passes Zod validation.

**Double-Check**: The hash must NOT contain PHI itself (can't be reversed to reveal patient data). Use `sha256(tenant_id + mrn + salt)` pattern. Don't use the patient's name or other direct identifiers in the hash input.

---

### T-211: Migrate from Dead `genAllQueries` to Live Query Functions

- **Files**: `G:\elogbook\packages\shared\src\queries\`
- **Severity**: 🟡 MEDIUM — Code Quality

**What to do**: The `genAllQueries` function exists but all consumers should use individual named query functions. Fix:
1. Search all 3 packages for imports or references to `genAllQueries`
2. Replace each usage with the corresponding individual query function
3. Remove the `genAllQueries` export
4. If no consumers exist, simply delete it

**Verification**: `pnpm typecheck` passes. No references to `genAllQueries` remain in the codebase.

**Double-Check**: Some consumers may use the generic return type of `genAllQueries` — ensure the individual query functions return the same shape.

---

### T-212: Add Missing Rollback SQL for Migrations 00028–00031

- **Files**: `G:\elogbook\docs\migration-rollback-plan.md`
- **Severity**: 🟡 MEDIUM — Maintainability

**What to do**: The rollback plan has SQL for migrations 00019–00025 but not for 00028–00031 (created in v2). Add rollback SQL for:
1. `00028_add_missing_tenant_id.sql` — DROP policies, DROP triggers, ALTER TABLE DROP COLUMN
2. `00029_add_check_constraints_and_indexes.sql` — DROP constraints, DROP indexes
3. `00030_add_case_attachment_audit_fields.sql` — DROP columns
4. `00031_add_program_goal_timestamps.sql` — DROP trigger, DROP function, DROP columns

**Verification**: File contains rollback SQL for all 4 migrations.

**Double-Check**: Rollback SQL must be tested against a local Supabase instance to verify it correctly reverses the migration.

---

### T-213: Add Audit Log Retention Policy + PHI Access Alerting

- **Files**: New Supabase scheduled edge function: `supabase/functions/audit-maintenance/index.ts`
- **Severity**: 🟠 HIGH — Security/Compliance

**What to do**: The `audit_logs` table has no retention policy and no alerting on PHI access patterns. Fix:
1. Create a scheduled edge function (cron trigger) that:
   - Purges `audit_logs` older than 90 days (or regulatory requirement)
   - Checks for anomalous PHI access patterns (e.g., >100 rows accessed by a single user in 5 minutes)
   - Sends alert via email/webhook if suspicious patterns found
2. Schedule with Supabase cron: `'0 0 * * *'` (daily at midnight)

**Verification**: Function exists, is scheduled, and can run manually via `curl`.

**Double-Check**: Retention period may need to be 7 years for medical records — verify with compliance requirements. PHI access alert thresholds should be configurable.

---

### T-214: Fix `pnpm-workspace.yaml` Placeholder Text

- **Files**: `G:\elogbook\pnpm-workspace.yaml`
- **Severity**: 🟡 MEDIUM — Build

**What to do**: The `allowBuilds` section contains literal text `set this to true or false` instead of a valid boolean. Typos or invalid values here can silently prevent dependency builds. Fix:
1. Replace the placeholder with the correct boolean value
2. Understand what the `allowBuilds` entry controls (likely Node.js native addon compilation)

**Verification**: File contains proper values; `pnpm install` succeeds without warnings.

**Double-Check**: If unsure what the correct value should be, check if any dependencies require native builds (node-gyp, etc.). Most pure-JS packages don't need builds.

---

### T-215: Add Missing Database Indexes

- **Files**: New migration `supabase/migrations/00032_add_performance_indexes.sql`
- **Severity**: 🟡 MEDIUM — Performance

**What to do**: Based on query pattern analysis, add indexes for:
1. `audit_logs(created_at, user_id)` — for retention queries and user audit trails
2. `case_entries(resident_id, status)` — for dashboard queries filtering by resident + status
3. `approval_requests(supervisor_id, status)` — for supervisor dashboard
4. `ai_query_logs(tenant_id, created_at)` — for rate limiting queries

**Verification**: `pnpm typecheck` passes. Indexes exist after migration.

**Double-Check**: Don't over-index — each index adds write overhead. Monitor `EXPLAIN ANALYZE` on slow queries before/after.

---

## Phase 3: Mobile Hardening (6 tasks)

### T-216: Add Biometric Re-authentication

- **Files**: `G:\elogbook\apps\mobile\app\_layout.tsx`
- **Severity**: 🟠 HIGH — Security

**What to do**: The mobile app has no biometric re-auth when coming to foreground. Any person with the unlocked phone can access PHI. Fix:
1. Install `expo-local-authentication`
2. Add `AppState` listener in `_layout.tsx` that triggers biometric prompt on foreground
3. Cache auth state for a grace period (e.g., 5 minutes after last interaction)
4. Handle fallback gracefully when biometrics not enrolled/available (require app PIN or password re-entry)

**Verification**: App prompts for biometric (Face ID / fingerprint) when coming to foreground after being backgrounded.

**Double-Check**: Must handle the following edge cases: biometrics not enrolled, device doesn't support biometrics, user cancels, timeout. On iOS, must set `NSFaceIDUsageDescription` in `Info.plist`. Test on both iOS Simulator and Android Emulator.

---

### T-217: Add Screen Capture Prevention

- **Files**: `G:\elogbook\apps\mobile\app\_layout.tsx`, PHI-sensitive screens
- **Severity**: 🟠 HIGH — Security

**What to do**: PHI screens can be screenshotted/recorded without restriction. Fix:
1. Install `expo-screen-capture`
2. Use `activateScreenCaptureProtectionAsync()` when navigating to PHI screens
3. Use `deactivateScreenCaptureProtectionAsync()` when leaving them
4. At minimum, protect: case details, patient lists, approval screens

**Verification**: Screenshot/screen recording on protected screens shows blank or black content.

**Double-Check**: Screen capture prevention can degrade UX (users can't share screenshots for legitimate purposes). Consider only protecting screens that display detailed PHI, not summary/dashboard views.

---

### T-218: Add Deep Link Handling for Auth

- **Files**: `G:\elogbook\apps\mobile\app\_layout.tsx`
- **Severity**: 🟡 MEDIUM — Functionality

**What to do**: The mobile app doesn't handle `supabase://` deep links, which are used for auth callbacks (magic link flow). Fix:
1. Configure deep link scheme in `app.json` (`"scheme": "elogbook"`)
2. Register a deep link handler in `_layout.tsx` that parses auth tokens from the URL
3. Forward parsed tokens to Supabase auth `setSession()`
4. Handle both iOS Universal Links and Android App Links

**Verification**: Opening a `supabase://` deep link from an email triggers successful auth.

**Double-Check**: Test with real Supabase magic link flow. The deep link URL structure depends on Supabase auth configuration. Check Supabase dashboard for the correct redirect URL template.

---

### T-219: Fix Offline Sync Potential Data Loss

- **Files**: `G:\elogbook\apps\mobile\services\sync.ts`
- **Severity**: 🟡 MEDIUM — Data Integrity

**What to do**: The offline/online sync may lose data during conflict resolution or network interruption. Fix:
1. Review conflict resolution: ensure server wins on `updated_at` for official records, local wins for drafts
2. Add transaction wrapping for push operations (all-or-nothing batch)
3. Add retry logic with exponential backoff for failed pushes
4. Log sync failures to a local queue for later inspection

**Verification**: Sync tests pass. Simulate network interruption during sync — no data loss.

**Double-Check**: Medical data requires careful conflict resolution. Document the conflict strategy clearly. Consider adding a "sync health" indicator to the UI so users know if their data is pending upload.

---

### T-220: Add E2E Tests for Mobile

- **Files**: New directory `G:\elogbook\apps\mobile\e2e\`
- **Severity**: 🟡 MEDIUM — Testing

**What to do**: There are no E2E tests for the mobile app (only a unit test smoke test from T-143). Fix:
1. Set up Detox or Maestro for mobile E2E testing
2. Write a basic login flow test (magic link or email/password)
3. Write a case submission flow test
4. Add E2E test run to CI (separate job)

**Verification**: E2E test passes on CI.

**Double-Check**: E2E tests for mobile are notoriously slow and flaky. Start with a single critical-path test. Maestro is simpler than Detox for initial setup. E2E tests need a running Supabase instance — consider Supabase local dev via `supabase start`.

---

### T-221: Fix Mobile UI Consistency Issues

- **Files**: `G:\elogbook\apps\mobile\components\` (StatusBadge, ProgressRing, etc.)
- **Severity**: 🔵 LOW — Polish

**What to do**: Address minor visual inconsistencies found during audit:
1. StatusBadge: ensure consistent border colors across all statuses
2. ProgressRing: verify native font size matches web (fixed in T-134 but re-check)
3. Color token audit: ensure no hardcoded colors remain (fixed in T-145 but check for more)
4. Verify safe area padding on all screens

**Verification**: Visual audit on both iOS and Android simulators.

**Double-Check**: Some color differences may be platform-specific expectations (iOS uses different shadow styles than Android). Don't force identical rendering if platform-native is preferred.

---

## Phase 4: Web Polish & Dedup (8 tasks)

### T-222: Fix `useApprovalsData` Hook Duplication

- **Files**: `G:\elogbook\apps\web\components\approvals\ApprovalsDashboard.tsx`, `G:\elogbook\apps\web\components\approvals\useApprovalsData.ts`
- **Severity**: 🟠 HIGH — Code Quality

**What to do**: `ApprovalsDashboard.tsx` has ~100 lines of inline data fetching logic that duplicates the `useApprovalsData` hook defined in the same directory. The hook is never imported. Fix:
1. Replace the inline logic with `import { useApprovalsData } from './useApprovalsData'`
2. Verify the hook returns the same data shape (may need slight adaptation)
3. Delete the duplicated code block

**Verification**: Approvals dashboard shows identical data with correct filtering/sorting. `pnpm typecheck` passes.

**Double-Check**: The inline code may have diverged from the hook — compare return values, filter logic, and error handling. Test both states (approvals pending vs. none). The inline code may include bug fixes not in the hook.

---

### T-223: Fix AppHeader N+1 Query

- **Files**: `G:\elogbook\apps\web\components\layout\AppHeader.tsx`
- **Severity**: 🟡 MEDIUM — Performance

**What to do**: The AppHeader makes separate queries for user profile and permissions, one per data item. Fix:
1. Combine profile + permissions into a single Supabase query
2. Use a single `supabase.from('profiles').select('*, ...').eq('id', userId).single()`
3. OR batch with `Promise.all` at minimum (already done for some routes in T-124)

**Verification**: Network tab shows 1 query instead of 3+ for AppHeader on page load.

**Double-Check**: The RLS policy for profiles must support the combined query. Verify with `EXPLAIN ANALYZE` that it doesn't degrade performance.

---

### T-224: Export `Pagination` from `ui/index.ts`

- **Files**: `G:\elogbook\apps\web\components\ui\index.ts`
- **Severity**: 🟡 MEDIUM — Code Quality

**What to do**: The `Pagination` component exists in `ui/` but is not exported from the barrel file `index.ts`. Consumers must import it directly. Fix:
1. Add `export { Pagination } from './Pagination'` to the barrel file
2. Check for any other missing exports in the same file
3. Update any direct imports to use the barrel file

**Verification**: `import { Pagination } from '@/components/ui'` works.

**Double-Check**: The barrel file may intentionally omit some components (internal-only). Verify Pagination is meant to be public.

---

### T-225: Add Suspense Boundaries and Loading States

- **Files**: `G:\elogbook\apps\web\app\(dashboard)\page.tsx`, `G:\elogbook\apps\web\app\cases\page.tsx`, etc.
- **Severity**: 🟡 MEDIUM — UX

**What to do**: Several data-fetching pages lack Suspense boundaries and proper loading fallbacks. Fix:
1. Wrap data-fetching components in `<Suspense fallback={<LoadingSkeleton />}>`
2. Create a reusable `LoadingSkeleton` component for dashboard cards, case lists, etc.
3. Add error boundaries at the page level (not just global)

**Verification**: Pages show loading skeleton while data is being fetched. Errors show friendly error UI instead of blank page.

**Double-Check**: Next.js 16 may have different Suspense behavior than earlier versions. Use `loading.tsx` for route-level loading and `<Suspense>` for component-level.

---

### T-226: Delete Scratch/Test Files

- **Files**: Various — search for patterns
- **Severity**: 🔵 LOW — Cleanup

**What to do**: Search for leftover scratch/test files from development:
1. Look for files with names like `*.scratch.*`, `test-*.tsx`, `_tmp*`, `backup.*`
2. Look for commented-out code blocks that span entire files
3. Look for duplicate utility files that are clearly experimental

**Verification**: No obvious scratch files remain. `pnpm typecheck` passes.

**Double-Check**: Be careful not to delete actual test files or utility functions. Check with `git log --diff-filter=D` if unsure about a file's purpose.

---

### T-227: Fix Remaining Unsafe Type Casts

- **Files**: Various — search for `as any` and `as unknown as`
- **Severity**: 🔵 LOW — Type Safety

**What to do**: Search all 3 packages for remaining unsafe type casts and fix where possible:
1. Grep for `as unknown as`, `as any`, `as never`
2. Replace with Zod `.parse()` or proper type guards where feasible
3. Document any casts that are genuinely unavoidable

**Verification**: `pnpm typecheck` passes. Count of unsafe casts is meaningfully reduced.

**Double-Check**: Some casts are unavoidable (e.g., PostgREST response types that are union types with different shapes). Focus on casts that obscure real type errors, not on casts that are needed for valid reasons.

---

### T-228: Add E2E Auth Flow Tests for Web

- **Files**: New directory `G:\elogbook\apps\web\e2e\`
- **Severity**: 🟡 MEDIUM — Testing

**What to do**: There are no E2E tests for the web app. Fix:
1. Set up Playwright (or Cypress) for web E2E testing
2. Write critical-path tests:
   - Login flow (magic link / email-password)
   - Dashboard page loads with correct data
   - Case submission creates a record
   - Approval flow works end-to-end
3. Add E2E test run to CI (separate job, after build)
4. Add `e2e-test` script to root `package.json`

**Verification**: E2E tests pass on CI.

**Double-Check**: E2E tests need a running Supabase instance — use `supabase start` for local dev in CI. Use test-specific Supabase project or seed data. Magic link flow is hard to E2E test — start with email-password auth.

---

## Phase 5: Infrastructure & CI/CD (7 tasks)

### T-229: Fix CI/CD `needs:` Constraints and Add Deploy-Prep Job

- **Files**: `G:\elogbook\.github\workflows\ci.yml`
- **Severity**: 🟠 HIGH — CI

**What to do**: The CI pipeline added in T-136 may have incorrect `needs:` constraints. Fix:
1. Review the workflow DAG — ensure `validate-migrations`, `test`, and `build` all run in correct order
2. Add a `deploy-prep` job that runs after successful test+build, prepares artifacts
3. Ensure `deploy-prep` doesn't auto-deploy to production
4. Add timeout constraints to all jobs

**Verification**: CI pipeline completes successfully with correct job ordering.

**Double-Check**: `needs:` with incorrect job names causes silent CI failures. Validate by pushing to a branch (or check workflow syntax with `act --dry-run`).

---

### T-230: Add CD Deployment Pipeline

- **Files**: New file `G:\elogbook\.github\workflows\deploy.yml`
- **Severity**: 🟡 MEDIUM — DevOps

**What to do**: There is no deployment pipeline — CI builds but never deploys. Fix:
1. Create a deploy workflow triggered by push to `main` or `release/*` branches
2. Add environments: `staging` (auto-deploy from main) and `production` (manual approval gate)
3. Include steps for: Supabase migrations, edge function deployment, web app deployment, mobile app build submission
4. Configure necessary secrets in GitHub (Supabase service-role key, deployment URLs, etc.)

**Verification**: Workflow exists, is valid YAML, and can be triggered manually.

**Double-Check**: Deployment secrets must be stored in GitHub Actions secrets, not in the repo. The service-role key has admin access to Supabase — protect it carefully. Mobile app deployment (EAS Build) requires additional configuration.

---

### T-231: Move `DB_HOST` to GitHub Secrets

- **Files**: `G:\elogbook\.github\workflows\ci.yml`
- **Severity**: 🟡 MEDIUM — Security

**What to do**: The CI workflow may have `DB_HOST` or database connection strings hardcoded. Fix:
1. Search the CI config for hardcoded hostnames, connection strings, or URLs
2. Move them to GitHub Actions secrets
3. Use `${{ secrets.DB_HOST }}` style references

**Verification**: CI config contains no hardcoded sensitive values.

**Double-Check**: `DB_HOST` for Supabase is the project's database URL, which changes if you reset the project. Rotating it means updating the GitHub secret.

---

### T-232: Set Up Automated Dependency Updates (Renovate/Dependabot)

- **Files**: New file `G:\elogbook\.github\renovate.json` or `G:\elogbook\.github\dependabot.yml`
- **Severity**: 🔵 LOW — Maintainability

**What to do**: Dependencies are updated manually, leading to drift and security vulnerabilities. Fix:
1. Configure Renovate (recommended for pnpm monorepos) or Dependabot
2. Set up weekly schedule, grouped updates for devDependencies
3. Configure to respect pnpm workspace structure
4. Add `reviewers` list for PR assignment

**Verification**: Bot creates a dependency update PR within the configured schedule.

**Double-Check**: Renovate has better pnpm monorepo support than Dependabot. Configure `docker-compatible` for the Docker image updates too.

---

### T-233: Add Security Scan to CI (Trivy/Snyk)

- **Files**: `G:\elogbook\.github\workflows\ci.yml`
- **Severity**: 🔵 LOW — Security

**What to do**: CI has no security scanning. Fix:
1. Add a `security-scan` job in CI that runs after build
2. Use Trivy for container/Docker image scanning
3. OR use `npm audit` / `pnpm audit` for dependency vulnerability scanning
4. Configure to fail on CRITICAL/HIGH severity vulnerabilities

**Verification**: CI includes a security scan job that passes.

**Double-Check**: `pnpm audit` may report false positives for some packages. Configure severity thresholds to avoid noisy failures. Consider adding a `.snyk` policy file for ignore rules.

---

### T-234: Document Deployment Process

- **Files**: New file `G:\elogbook\docs\deployment.md`
- **Severity**: 🔵 LOW — Documentation

**What to do**: There is no deployment documentation. Fix:
1. Write deployment process covering:
   - Prerequisites (Supabase project, Vercel/Netlify account, EAS Build)
   - Environment setup (staging vs production)
   - Database migration steps
   - Edge function deployment steps
   - Web app deployment steps
   - Mobile app build submission steps
   - Rollback procedure

**Verification**: File exists and accurately describes the deployment process.

**Double-Check**: Keep documentation minimal and accurate — stale docs are worse than no docs. Reference actual script commands rather than vague descriptions.

---

### T-235: Add Storage Bucket RLS Policies

- **Files**: New migration `supabase/migrations/00033_add_storage_bucket_rls.sql`
- **Severity**: 🟠 HIGH — Security

**What to do**: Storage buckets (`case-attachments`, `patient-documents`) have no RLS on `storage.objects`. Any authenticated user can read/write any file. Fix:
1. Add RLS policies for `storage.objects`:
   - SELECT: only if user's `tenant_id` matches object's owner tenant
   - INSERT: only if user has `case:write` or `case:upload` permission
   - DELETE: only if user owns the object or is supervisor/admin
2. Create a migration that enables RLS on the `storage.objects` table

**Verification**: `SELECT` on storage from wrong tenant returns empty. `pnpm typecheck` passes.

**Double-Check**: Storage RLS uses a different policy syntax than table RLS. The `storage.objects` table has `bucket_id`, `name`, `owner`, `metadata` columns. Policies reference `auth.uid()` for the `owner` column.

---

## Verification Checklist

### Per-Phase Checklist

- [ ] **Phase 1 (Critical Security)**: All 8 tasks complete. `pnpm typecheck` passes. No CRITICAL issues remain.
- [ ] **Phase 2 (Data Integrity)**: All 7 tasks complete. StripeEvent type matches DB schema. `patient_hash` never empty.
- [ ] **Phase 3 (Mobile Hardening)**: All 6 tasks complete. Biometric + screen capture working. Sync tested.
- [ ] **Phase 4 (Web Polish)**: All 8 tasks complete. `useApprovalsData` deduplicated. E2E tests exist. Suspense boundaries added.
- [ ] **Phase 5 (Infrastructure)**: All 7 tasks complete. CI/CD pipeline operational. Secrets properly managed.

### After Each Task

- [ ] `pnpm typecheck` passes (0 errors in all 3 packages)
- [ ] `pnpm test` passes (75+ tests)
- [ ] Read "Double-Check" section — verified edge cases
- [ ] No hardcoded secrets or credentials introduced

---

## Final Production Readiness

Before marking this plan as complete, verify:

- [ ] **All 6 🔴 CRITICAL issues resolved** (T-201, T-202, T-203, T-204, T-209, and prompt injection — T-201 covered)
- [ ] **All 12 🟠 HIGH issues resolved** (T-205, T-206, T-207, T-208, T-210, T-213, T-216, T-217, T-222, T-229, T-235, T-228)
- [ ] **All 18 🟡 MEDIUM issues resolved** (T-211, T-212, T-214, T-215, T-218, T-219, T-220, T-223, T-224, T-225, T-230, T-231, T-232, T-233, T-234, and remaining)
- [ ] **75+ tests passing** (typecheck + unit + E2E when available)
- [ ] **No hardcoded secrets/credentials** in tracked files
- [ ] **All font assets installed** for mobile app
- [ ] **Biometric auth + screen capture** active on mobile PHI screens
- [ ] **PDF generation** returns actual PDF, not HTML
- [ ] **Middleware** correctly named and running auth checks
- [ ] **API routes rate-limited** to prevent abuse
- [ ] **CI/CD pipeline** deploys without manual steps
- [ ] **Storage buckets** protected by RLS
- [ ] **Audit log retention + alerting** in place
- [ ] **Deployment documented** for on-call engineers
