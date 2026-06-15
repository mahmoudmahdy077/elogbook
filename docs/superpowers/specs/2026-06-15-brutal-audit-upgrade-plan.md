# E-Logbook Enterprise Transformation: Brutally Honest Audit & Comprehensive Upgrade Plan

**Date:** 2026-06-15 | **Scope:** Full-stack enterprise production readiness | **Status:** Pre-implementation

> This document replaces the previous upgrade design (`2026-06-10-enterprise-upgrade-design.md`) and implementation plan (`upgrade/implementation_plan.md`). The earlier plans significantly underestimated the scope and severity of issues found in this audit.

---

## Executive Summary: Brutally Honest Assessment

This project is **not production-ready**. It is not even close. It has a solid architectural vision — monorepo, Supabase, HeroUI, offline-first mobile — but the implementation is riddled with **critical security vulnerabilities, HIPAA violations, non-functional offline architecture, broken authentication flows, and systemic type safety failures**. The previous plans treated these as incremental improvements; they are actually blocking defects that must be fixed before any feature work continues.

**Top-line numbers:**
- **28 CRITICAL** issues (data breaches, privilege escalation, HIPAA violations, broken functionality)
- **34 HIGH** issues (security gaps, performance bottlenecks, missing auth)
- **38 MEDIUM** issues (design system violations, missing error handling, compliance gaps)
- **22 LOW** issues (inconsistencies, minor UX issues)

**The previous upgrade plan missed or understated:**
1. Plaintext secrets labeled "encrypted" — affects every Stripe payment flow
2. Privilege escalation allowing any user to set themselves as admin
3. Entire WatermelonDB offline layer is dead code — mobile has zero offline functionality
4. No authentication on any edge function — anyone can call them
5. PHI (patient MRN) sent to third-party AI services without a BAA
6. `btoa()` used as "hashing" — trivially reversible de-identification
7. Mobile auth tokens stored unencrypted on device
8. Missing UNIQUE constraint that will crash the approval flow at runtime

---

## Phase 0: Emergency Security Hardening (Week 1)

> Before ANY feature work, these issues must be resolved. They represent active security vulnerabilities and data integrity risks.

### 0.1 Database: Fix Critical Schema & RLS Bugs

**0.1.1 — Add missing UNIQUE constraint on `approval_requests`**
- File: `supabase/migrations/` (new migration `00011_critical_fixes.sql`)
- Issue: `ON CONFLICT (entry_id, supervisor_id)` in `approve_case()`/`reject_case()` will crash at runtime because no UNIQUE constraint exists
- Fix: `ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_entry_supervisor_unique UNIQUE (entry_id, supervisor_id);`

**0.1.2 — Fix privilege escalation in auth trigger**
- File: `supabase/migrations/00004_auth_triggers.sql`
- Issue: `raw_user_meta_data->>'role'` allows any user to set their role to `admin` during signup
- Fix: Remove role from user-settable metadata. Use DEFAULT 'resident' in trigger. Role changes must go through admin-only RPC.

**0.1.3 — Fix audit log forgery vulnerability**
- File: `supabase/migrations/00002_rls_policies.sql`
- Issue: Any authenticated user can INSERT into `audit_logs`
- Fix: Revoke INSERT from all roles. Audit logs must ONLY be writable by triggers and service role.

**0.1.4 — Authorize RPC functions `approve_case()` and `reject_case()`**
- File: `supabase/migrations/00009_concurrent_approval_lock.sql`
- Issue: SECURITY DEFINER functions with NO role or tenant check. Any user can approve any case.
- Fix: Add `IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN RAISE EXCEPTION 'Insufficient role'; END IF;` and tenant validation.

**0.1.5 — Fix `get_case_stats()` tenant isolation bypass**
- Issue: Accepts arbitrary `p_tenant_id` parameter, bypassing RLS
- Fix: Remove parameter, use `get_tenant_id()` from JWT claims exclusively

**0.1.6 — Add authorization to ALL edge functions**
- Files: `supabase/functions/*/index.ts`
- Issue: No JWT verification on `create-checkout`, `generate-pdf`, `ai-insights`
- Fix: Add `const { data: { user } } = await supabase.auth.getUser(authHeader)` at the top of every handler. Return 401 if no valid user.

**0.1.7 — Remove plaintext secrets pattern, implement real encryption**
- Issue: `encrypted_api_key`, `encrypted_secret_key`, `encrypted_webhook_secret` columns store PLAINTEXT. Naming is misleading and dangerous.
- Fix:
  - Use `pgp_sym_encrypt()` with a vault key for encryption at rest
  - Or: Move secrets to Supabase Vault (`supabase.vault`)
  - Create server-only edge function to retrieve and decrypt secrets
  - Remove `AIConfig.encrypted_api_key` and `PaymentGatewayConfig.encrypted_*` from `@elogbook/shared` types — secrets must NEVER be in client bundles

**0.1.8 — Remove demo password hash from production migration**
- File: `supabase/migrations/00006_demo_accounts.sql`
- Fix: Add `IF current_setting('app.environment', true) = 'development'` guard. Never create demo accounts in production.

**0.1.9 — Fix XSS in PDF generation**
- File: `supabase/functions/generate-pdf/index.ts`
- Issue: User-supplied data interpolated directly into HTML
- Fix: Use DOMPurify-equivalent (or manual HTML entity escaping) for all dynamic content. Remove `patient_mrn` from PDF output entirely.

**0.1.10 — Fix catastrophic cascading delete on resident removal**
- Issue: `case_entries.resident_id ON DELETE CASCADE` permanently destroys medical records when a resident profile is deleted
- Fix: Change to `ON DELETE RESTRICT` (or soft-delete via `deleted_at` column). Medical data must be immutable.

### 0.2 Web: Fix Critical Security & Auth

**0.2.1 — Add tenant authorization to middleware**
- File: `apps/web/lib/supabase/middleware.ts`
- Issue: Middleware only checks authentication, not tenant membership. User from tenant A can access tenant B's data.
- Fix: After auth check, verify `profile.tenant_id` matches the URL `[tenant]` parameter. Return 403 if mismatch.

**0.2.2 — Add CSRF protection to all forms**
- Issue: Login form, signout form, and case submission form have no CSRF tokens
- Fix: Use Next.js server actions with `cookies()` for CSRF, or add Supabase's built-in CSRF protection.

**0.2.3 — Remove secret keys from client-side code**
- Files: `PaymentGatewayPanel.tsx`, `AIConfigPanel.tsx`
- Issue: API keys and webhook secrets are sent as plaintext from the client browser
- Fix: Create server-side Edge Functions or Next.js API routes for all secret operations. The client should never handle `encrypted_*` fields directly.

**0.2.4 — Stop sending role in client-writable user_metadata**
- File: `UserManager.tsx`
- Issue: `signInWithOtp` passes `role` in `user_metadata` which is client-writable
- Fix: Create a server-side admin function for role assignment. Never accept role from client code.

**0.2.5 — Replace `btoa()` with server-side cryptographic hashing**
- File: `CaseForm.tsx`
- Issue: `btoa()` is Base64 ENCODING, not hashing. It is trivially reversible. The "de-identified" mode is a false promise.
- Fix: Send MRN to a server endpoint that hashes it with the server-side `hash_patient_mrn()` function. The client should NEVER have access to the hash algorithm or salt.

**0.2.6 — Add error boundaries to app**
- Issue: ZERO React error boundaries in the entire application
- Fix: Add `ErrorBoundary` component wrapping:
  - Root layout (catches everything)
  - Authenticated layout
  - Each route page (allows page-level recovery)

**0.2.7 — Add authentication check to case detail page**
- File: `apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx`
- Issue: Any authenticated user can view any case by ID (IDOR vulnerability)
- Fix: Verify `case_entry.resident_id === profile.id` (for residents) or `case_entry.tenant_id === profile.tenant_id` (for supervisors/directors)

### 0.3 Mobile: Fix Critical Security & Auth

**0.3.1 — Replace AsyncStorage auth tokens with expo-secure-store**
- File: `apps/mobile/lib/supabase.ts`
- Issue: Auth tokens stored in unencrypted AsyncStorage — HIPAA violation
- Fix: Use `expo-secure-store` for token persistence. AsyncStorage should only be used for non-sensitive preferences.

**0.3.2 — Fix `detectSessionInUrl: false` breaking magic link auth**
- File: `apps/mobile/lib/supabase.ts`
- Issue: Deep link authentication is disabled, making magic links non-functional
- Fix: Set `detectSessionInUrl: true` and configure the URL scheme properly

**0.3.3 — Add Zod validation to mobile form submissions**
- File: `apps/mobile/app/(tabs)/log-case.tsx`
- Issue: Raw strings sent to Supabase with no validation
- Fix: Import and use `caseEntrySchema` from `@elogbook/shared` before any `supabase.from('case_entries').insert()`

**0.3.4 — Add de-identification toggle to mobile case form**
- Issue: Mobile form has no de-identification toggle, violating HIPAA Safe Harbor
- Fix: Add `is_deidentified` Switch component. When ON, hide MRN/DOB fields and send `patient_age_years` + `patient_hash` instead.

**0.3.5 — Encrypt offline case data at rest**
- File: `apps/mobile/lib/db/storage.ts`
- Issue: Patient MRN, DOB, and all case data stored as plaintext JSON in AsyncStorage
- Fix: Use `expo-secure-store` for sensitive fields, or encrypt the entire AsyncStorage payload with a device-specific key.

### 0.4 Shared Package: Fix Type Safety & Security

**0.4.1 — Remove secret-containing types from client exports**
- File: `packages/shared/src/types/database.ts`
- Issue: `AIConfig` (contains `encrypted_api_key`) and `PaymentGatewayConfig` (contains secret keys) exported to client bundles
- Fix: Split `database.ts` into `database.ts` (client-safe types) and `database.server.ts` (types containing secrets). Only export the client-safe types from `index.ts`.

**0.4.2 — Fix template field key/name mismatch**
- Issue: `seed.sql` uses `"name"` as field key, but TypeScript types and migration 00005 use `"key"`
- Fix: Standardize on `"key"` in seed.sql, or add both fields with migration

**0.4.3 — Add missing database constraints as Zod types**
- Files: `packages/shared/src/schemas/`
- Fix: Add `region` union type, `compliance_frameworks` union type, `tier` union type matching database CHECK constraints

---

## Phase 1: Database & Backend Hardening (Week 2-3)

### 1.1 Schema Fixes & Additions

**1.1.1 — Add missing indexes**
- `(tenant_id, status)` on `case_entries` — primary dashboard query
- `(tenant_id, resident_id, status)` on `case_entries` — resident case list
- `(entry_id, supervisor_id)` on `approval_requests` — concurrent approval locking
- `(tenant_id, status)` on `subscriptions` — lapsed tenant guard
- `(gateway_subscription_id)` on `subscriptions` — webhook lookup
- `(entry_id)` on `case_attachments` — case detail query
- `(user_id)` on `audit_logs` — audit log filtering
- `(created_at)` on `audit_logs` — time-based queries
- `(tenant_id)` on `payments` — billing queries
- GIN index on `audit_logs.changes` — JSONB queries

**1.1.2 — Add CHECK constraints**
- `tenants.tier` → `CHECK (tier IN ('free', 'premium', 'enterprise'))`
- `one_time_purchases.status` → `CHECK (status IN ('pending', 'completed', 'failed', 'refunded'))`
- `tenants.region` → `CHECK (region IN ('us-east-1', 'eu-west-1', 'me-south-1', 'ap-southeast-1'))`
- `tenants.compliance_frameworks` → CHECK each array element against allowed values

**1.1.3 — Add soft-delete support**
- Add `deleted_at TIMESTAMPTZ` to all critical tables: `profiles`, `tenants`, `case_entries`, `case_templates`
- Replace `ON DELETE CASCADE` with `ON DELETE SET NULL` where appropriate
- Add `WHERE deleted_at IS NULL` to all RLS policies and queries

**1.1.4 — Partition `audit_logs`**
- Partition by month on `created_at` using PostgreSQL declarative partitioning
- This prevents unbounded growth and improves query performance

**1.1.5 — Fix `hash_patient_mrn()` salt**
- Replace hard-coded `'elogbook-mrn-salt-v1'` with `current_setting('app.mrn_salt', true)` 
- Store the salt in Supabase Vault

**1.1.6 — Add webhook idempotency to payment processing**
- Add `stripe_event_id TEXT UNIQUE` column to `payments`
- Check for duplicate event IDs before processing

**1.1.7 — Fix `case_entries` status state machine**
- Add trigger to enforce valid transitions: `draft → pending → approved/rejected`, `rejected → draft`
- Prevent `approved → draft` or `approved → pending`

### 1.2 RLS Policy Improvements

**1.2.1 — Optimize correlated subqueries**
- Replace `resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())` with session variable caching
- Use `set_config('request.jwt.claims', ...)` in a helper function

**1.2.2 — Add tenant membership check to RLS**
- All RLS policies must verify that the user's `tenant_id` matches the row's `tenant_id`
- This is the database-level enforcement for the middleware tenant check

**1.2.3 — Guard non-`case_entries` writes for lapsed tenants**
- Extend `no_inserts_for_lapsed_tenants` and `no_submit_for_lapsed_tenants` to cover `case_attachments`, `approval_requests`, and `program_goals`

**1.2.4 — Remove `USING (true)` for admin ALL policies**
- Admin should have explicit SELECT, INSERT, UPDATE, DELETE policies with tenant scoping
- `USING (true)` should only exist for system-level operations

### 1.3 Edge Function Hardening

**1.3.1 — Add CORS restrictions**
- Replace `Access-Control-Allow-Origin: *` with environment-specific origins
- Add `Access-Control-Allow-Methods: POST` (not `*`)
- Add rate limiting headers or use Supabase's built-in rate limiting

**1.3.2 — Add environment variable validation**
- All `Deno.env.get()` calls must check for null/undefined
- Provide clear error messages for missing configuration

**1.3.3 — Add authentication to `generate-pdf`**
- Require JWT in Authorization header
- Verify caller has appropriate role

**1.3.4 — Add PHI guard to `ai-insights`**
- Strip `patient_mrn` and `patient_dob` from AI prompts
- Only send `patient_age_years`, `patient_hash`, `specialty`, and anonymized `field_values`
- Add `is_deidentified` check — refuse to send identified data to third-party AI
- Add response disclaimer logging as per spec requirement

**1.3.5 — Fix `create-checkout` missing `stripe_price_id`**
- Add `stripe_price_id` column to `subscription_plans` table
- Add migration to populate from plan metadata
- Fix checkout function to use this column

**1.3.6 — Add request validation to all edge functions**
- Use Zod schemas from `@elogbook/shared` on all incoming request bodies
- Return 400 with specific validation errors

---

## Phase 2: Web Application Transformation (Week 3-5)

### 2.1 Architecture Fixes

**2.1.1 — Add React Error Boundaries**
```
<ErrorBoundary fallback={<ErrorDisplay />}>
  <App />
</ErrorBoundary>
```
- One at root level, one per route group, one per complex component

**2.1.2 — Add Suspense boundaries with loading skeletons**
- Every server component data fetch wrapped in `<Suspense fallback={<TableSkeleton />}>`
- Create `TableSkeleton`, `CardSkeleton`, `FormSkeleton` components using HeroUI's `Skeleton` component

**2.1.3 — Eliminate redundant auth queries**
- Create a React `cache()` wrapper for `createServerSupabase` 
- Use a single server-side function to get user + profile + tenant + subscription in ONE query with joins
- Pass data via React context instead of re-fetching in every page

**2.1.4 — Fix Next.js config security**
- Add Content Security Policy headers
- Add X-Frame-Options, HSTS, X-Content-Type-Options
- Add `images.domains` for Supabase storage
- Add `transpilePackages: ['@heroui/react', '@elogbook/shared']`

**2.1.5 — Fix client Supabase singleton**
- Replace per-call `createClient()` with module-level singleton pattern
- Use `useState(() => createClient())` for client components

### 2.2 Component Refactoring

**2.2.1 — Split CaseForm.tsx (888 lines) into focused sub-components**
- `CaseForm.tsx` (~150 lines) — main orchestration, state management
- `StepIndicator.tsx` (~60 lines) — wizard progress indicator
- `TemplateStep.tsx` (~120 lines) — template selection
- `PatientInfoStep.tsx` (~130 lines) — de-identification toggle + MRN/DOB
- `CaseDetailsStep.tsx` (~150 lines) — template field values
- `ReviewStep.tsx` (~100 lines) — case review before submit
- `ConfirmDialog.tsx` (~60 lines) — submission confirmation

**2.2.2 — Fix CaseForm de-identification**
- Remove `btoa()` "hashing"
- Send MRN to server endpoint for real hashing
- When de-identified, send `patient_mrn: null`, `patient_dob: null`, `patient_age_years`, and server-computed `patient_hash`

**2.2.3 — Fix CaseForm draft validation**
- Apply `caseEntrySchema.safeParse` to drafts as well as submissions
- Or: Create a separate `caseEntryDraftSchema` that allows partial data

**2.2.4 — Fix ApprovalActions transaction**
- Use Supabase's `rpc()` to call `approve_case()`/`reject_case()` instead of two separate updates
- This is already provided by the database functions — use them!

**2.2.5 — Fix login redirect**
- Replace `location.href = '/dashboard'` with Next.js `router.push('/${tenantSlug}/dashboard')`
- Preserve the intended URL from middleware for post-login redirect

**2.2.6 — Fix `as any` type assertions**
- Generate Supabase types with `supabase gen types typescript`
- Replace all `as any` and `as unknown as` patterns with proper generated types

### 2.3 HeroUI Design System Implementation

**2.3.1 — Replace hardcoded colors with design tokens**
- Create `globals.css` custom properties from `design-tokens.ts`:
```css
:root {
  --color-backdrop: #060814;
  --color-surface: rgba(15, 23, 42, 0.8);
  --color-primary: #0D9488;
  --color-secondary: #6366F1;
  --color-neutral-light: #E2E8F0;
  --color-neutral-dark: #0F172A;
  --font-heading: 'Outfit', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'Geist Mono', monospace;
}
```
- Replace all hardcoded hex colors in components with `var(--color-*)` references
- Replace all hardcoded font references with `var(--font-*)`

**2.3.2 — Implement glass-panel design system**
- Replace all card borders with `.glass-panel` class (backdrop-filter: blur(12px), semi-transparent backgrounds)
- Apply thin `rgba(99, 102, 241, 0.15)` borders
- Reserve `.glass-panel` for transient overlays ONLY
- Use opaque `.panel` class for data-dense content containers

**2.3.3 — Implement case status glow badges**
```css
.badge-pending { box-shadow: 0 0 8px rgba(217, 119, 6, 0.4); color: #D97706; }
.badge-approved { box-shadow: 0 0 8px rgba(5, 150, 105, 0.4); color: #059669; }
.badge-rejected { box-shadow: 0 0 8px rgba(220, 38, 38, 0.4); color: #DC2626; }
.badge-draft { border: 1px solid rgba(148, 163, 184, 0.3); color: #94A3B8; }
```

**2.3.4 — Fix WCAG AAA contrast failures**
- `#EF4444` on `#0F172A` → 4.1:1 (fails AAA) → use `#FCA5A5` for text or increase background contrast
- `#F59E0B` on dark → use `#FCD34D` for body text or `#F59E0B` only for large heading text (4.5:1 for AA large)
- `text-gray-400` on `bg-black` → replace with `text-gray-300` or lighter

**2.3.5 — Implement animated SVG progress rings**
- Replace `ProgressRing.tsx` with animated version using `framer-motion` `useMotionValue`
- Add glow effect on progress path (`filter: drop-shadow(0 0 6px currentColor)`)
- Animate percentage on mount with spring physics

**2.3.6 — Implement case logging wizard**
- Multi-step form with animated step indicator
- Step 1: Template selection (card grid with specialty icons)
- Step 2: De-identification toggle + patient info
- Step 3: Template field values (auto-focus first field)
- Step 4: Review with all data displayed in monospace for clinical data
- Step 5: Confirmation with haptic feedback and success animation

**2.3.7 — Code-split HeroUI imports**
- Use `next/dynamic` for heavy components: `Table`, `Modal`, `Popover`
- Lazy-load `SubscriptionPlans`, `AIInsightsPanel`, `PaymentGatewayPanel`
- Use HeroUI's tree-shaking by importing from individual subpaths

### 2.4 Performance Optimizations

**2.4.1 — Fix N+1 queries in dashboard**
- Replace `Promise.all(residentProfiles.map(async ...))` with a single Supabase query using joins
- Target: <3s dashboard render with 500 residents

**2.4.2 — Fix N+1 queries in mobile dashboard**
- Replace individual `goal_progress` queries with a single join query

**2.4.3 — Add pagination to all list views**
- Cases page: cursor-based pagination (20 per page)
- Audit log: cursor-based pagination with date/action filters
- Reports: pagination + aggregations done server-side

**2.4.4 — Parallelize independent server queries**
- Use `Promise.all()` for all independent Supabase queries
- Target: 50% reduction in server-side rendering time

**2.4.5 — Fix Supabase client caching**
- Server: Use React `cache()` for deduplication within a request
- Client: Use module-level singleton, not per-call `createClient()`

---

## Phase 3: Mobile Application Rebuild (Week 4-6)

### 3.1 Fix Expo Configuration

**3.1.1 — Add missing Expo plugins to `app.json`**
```json
"plugins": [
  "expo-router",
  "expo-camera",
  "expo-image-picker",
  "expo-notifications",
  "expo-haptics",
  "@react-native-community/blur",
  "@react-native-community/netinfo"
]
```

**3.1.2 — Add font loading to root layout**
- Use `expo-font` with `useFonts` hook for Outfit, Inter, Geist Mono
- Show splash screen until fonts are loaded

**3.1.3 — Add environment variables config**
```json
"extra": {
  "EXPO_PUBLIC_SUPABASE_URL": "YOUR_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "YOUR_KEY"
}
```

**3.1.4 — Add SafeAreaProvider**
- Wrap app with `SafeAreaProvider` from `react-native-safe-area-context`

### 3.2 Wire WatermelonDB for Real Offline Support

**3.2.1 — Replace AsyncStorage with WatermelonDB for offline data**
- `storage.ts` should use WatermelonDB's `database` for all case CRUD operations
- Draft cases stored in WatermelonDB with `local_sync_status: 'draft'`
- Templates cached in WatermelonDB's `case_templates` table

**3.2.2 — Implement real pull sync**
```
SyncService.pullCases():
  1. Fetch cases from Supabase where updated_at > lastSyncTimestamp
  2. Write to WatermelonDB
  3. Update lastSyncTimestamp
  
SyncService.pushCases():
  1. Read drafts from WatermelonDB where local_sync_status = 'draft' or 'modified'
  2. Submit to Supabase
  3. On success: update local status to 'synced'
  4. On conflict: mark local_sync_status = 'conflict'
```

**3.2.3 — Implement proper conflict resolution**
- Server-authoritative: if server record has `updated_at` > local, server wins
- If local draft conflicts with server version, present user with diff view
- Never silently overwrite server data

**3.2.4 — Cache templates offline**
- On first load, fetch templates from Supabase and store in WatermelonDB
- On reconnect, check for template updates and sync

### 3.3 Rebuild Mobile Screens

**3.3.1 — Implement full Approvals screen**
- Current: placeholder "No pending approvals."
- Required: List of pending cases with supervisor quick-approve/reject, batch actions, rejection feedback

**3.3.2 — Add Case Detail screen**
- Tapping a case in my-cases should navigate to a detail view
- Show all case fields, status, supervisor comments
- Allow resubmission for rejected cases

**3.3.3 — Add AI Insights screen (FR-018)**
- New `app/(tabs)/ai-insights.tsx`
- Connect to `ai-insights` edge function
- Stream responses with SSE
- Display disclaimer
- Quota indicator

**3.3.4 — Add Subscription Management to Profile**
- Show current plan, usage, upgrade CTA
- Stripe Checkout integration for upgrades

**3.3.5 — Add Role-Based Tab Visibility**
- Residents: Dashboard, Log Case, My Cases, AI Insights, Profile
- Supervisors: Dashboard, My Cases, Approvals, Profile
- Directors: Dashboard, My Cases, Approvals, AI Insights, Profile

### 3.4 Mobile Accessibility & Design

**3.4.1 — Add `accessibilityLabel` and `accessibilityRole` to ALL interactive elements**
- Every button, tab, input, and card needs accessibility labels
- Use `accessibilityRole="button"`, `accessibilityRole="tab"`, etc.

**3.4.2 — Replace `bg-black` with `bg-backdrop` (#060814) everywhere**
- Login screen, approvals screen, and various others use flat black
- Replace with the clinical slate-indigo backdrop per DESIGN.md

**3.4.3 — Add error boundaries to root layout**
- Wrap app with React error boundary
- Show recovery screen with "Reload" and "Report Issue" buttons

**3.4.4 — Add pull-to-refresh to all list screens**
- My Cases, Approvals, Dashboard all need RefreshControl

**3.4.5 — Fix date input**
- Replace plain `TextInput` with `expo-datepicker` or `DateTimePicker`
- One-thumb operation requirement (FR-002)

---

## Phase 4: Compliance & Production Hardening (Week 5-6)

### 4.1 HIPAA/GDPR Compliance

**4.1.1 — Implement de-identification throughout**
- Web: Add `is_deidentified` toggle to CaseForm with HIPAA explanation
- Mobile: Add `is_deidentified` Switch to log-case screen
- Server: Never send MRN/DOB to third-party services
- PDF: Mask MRN in exports unless explicitly authorized

**4.1.2 — Fix audit trail completeness**
- Add DELETE triggers to all audit-critical tables (currently only INSERT and UPDATE audited)
- Include `user_agent`, `ip_address`, and `session_id` in all audit records
- Ensure PHI is redacted from `audit_logs.changes` when `is_deidentified = true`

**4.1.3 — Implement consent tracking**
- Add `consent_records` table: `id, user_id, consent_type, granted_at, revoked_at, version`
- Create RLS policy: users can only read their own consent records
- Add consent check API for AI queries and data exports

**4.1.4 — Implement data retention enforcement**
- Create a weekly Supabase cron job (`pg_cron`) that:
  - Finds data past `data_retention_days` for each tenant
  - Flags records for deletion
  - Executes deletion with audit trail logging

**4.1.5 — Add encryption at rest for Supabase secrets**
- Use Supabase Vault for API keys and webhook secrets
- Never expose encryption keys in client code
- Create server-only API for secret retrieval

### 4.2 Error Handling & Monitoring

**4.2.1 — Add global error handling**
- Web: React Error Boundaries at root, layout, and page levels
- Mobile: Error boundaries in root layout with recovery UI
- Edge functions: `try/catch` with structured error responses and logging

**4.2.2 — Add Sentry/BugSnag crash reporting**
- Both web and mobile
- Configure source maps
- Filter PHI from error reports

**4.2.3 — Add health check endpoint**
- `GET /api/health` → returns `{ status: 'ok', timestamp, db: 'connected', version }`
- Add to Supabase Edge Functions for uptime monitoring

**4.2.4 — Replace `console.error` with proper logging**
- Structured logging in all edge functions
- Log levels: `info`, `warn`, `error`
- Include `tenant_id`, `user_id`, `request_id` in all logs

**4.2.5 — Add rate limiting**
- Edge function rate limiting via Supabase Edge Functions middleware
- Per-user rate limits for AI queries (quota enforcement)
- Per-IP rate limits for auth endpoints

### 4.3 Testing Infrastructure

**4.3.1 — Add Vitest to `@elogbook/shared`**
- Test all Zod schemas: valid, invalid, and edge cases
- Test `caseEntrySchema` de-identified vs identified modes
- Test `aiQuerySchema`, `subscriptionSchema`, `authSchema`

**4.3.2 — Add Supabase RLS tests**
- Test all RLS policies with different roles (resident, supervisor, director, admin)
- Test cross-tenant isolation
- Test lapsed tenant write guards

**4.3.3 — Add Playwright E2E tests for web**
- Key user flows: login → create case → submit → approval
- Cross-tenant isolation: verify user A cannot access tenant B
- De-identification: verify MRN is not stored when toggle is ON

**4.3.4 — Add Detox E2E tests for mobile**
- Login flow
- Offline case creation → sync on reconnect
- Approval workflow

---

## Phase 5: Enterprise Feature Completion (Week 6-8)

### 5.1 SaaS Billing

**5.1.1 — Complete Stripe integration**
- Add `stripe_price_id` to `subscription_plans` table
- Fix `create-checkout` edge function to use proper price ID
- Implement webhook idempotency with `stripe_event_id`
- Add subscription management UI to billing page

**5.1.2 — Implement read-only grace period for lapsed tenants**
- Extend `no_submit_for_lapsed_tenants` to cover `case_attachments`, `approval_requests`
- Add 30-day grace period with `ReadOnlyBanner` on all write operations
- Add `SubscriptionStatusProvider` to check subscription status on app load

**5.1.3 — Add institution invoicing**
- Enterprise plans use manual invoicing, not Stripe Checkout
- Display "Contact Sales" for enterprise plans
- Add admin UI for managing institutional subscriptions

### 5.2 AI Insights

**5.2.1 — Redesign AI insights for compliance**
- Strip all PHI from prompts before sending to AI provider
- Add response disclaimer logging to `ai_query_logs`
- Implement rate limiting per user based on `quota_limit`
- Add streaming support for OpenAI and Anthropic

**5.2.2 — Add AI insights to mobile**
- New `app/(tabs)/ai-insights.tsx` screen
- SSE streaming for response display
- Quota indicator in header

### 5.3 Program Director Analytics

**5.3.1 — Build director dashboard (`admin/overview`)**
- KPI rings: compliance rate, average cases per resident, specialty distribution
- Donut chart: case status distribution
- Bar chart: cases by specialty
- Resident list with progress indicators

**5.3.2 — Fix `ProgramOverviewCharts.tsx`**
- Donut chart: fix `strokeLinecap: "round"` overlap
- Replace hardcoded colors with design tokens
- Add keyboard/touch accessibility to tooltips

---

## Phase 6: Mobile Design Parity & Polish (Week 7-8)

### 6.1 Design Token Alignment

**6.1.1 — NativeWind design token migration**
- Replace all `bg-black` → `bg-backdrop` (`#060814`)
- Replace all hardcoded hex colors with NativeWind theme mappings
- Configure `tailwind.config.js` with clinical design tokens matching web

**6.1.2 — Glass panel implementation**
- Mobile `GlassPanel` component: `BlurView` with semi-transparent background + thin border
- Only for overlays and modals (not data-dense cards)
- Performance: limit number of active BlurViews on screen

**6.1.3 — Badge status glow effects**
- RN doesn't support CSS `box-shadow` glow — use `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset`
- Implement glow badges for pending/approved/rejected statuses

### 6.2 Animation & Interaction

**6.2.1 — Animated Progress Rings**
- Use `react-native-reanimated` + `react-native-svg` for animated SVG rings
- Spring animation on mount
- Glow filter on progress path

**6.2.2 — Page transitions**
- Use `react-native-reanimated` for tab transition animations
- Spring-based modal slide-ups (no sudden appearances)

**6.2.3 — Haptic feedback**
- Execute subtle haptics on: case submit, approval action, tab switch, button press
- Use `expo-haptics` `notificationAsync(.success)` for major actions

### 6.3 Dark Mode Completion

**6.3.1 — Ensure all screens use clinical slate-indigo backdrop**
- Replace remaining `bg-black`, `bg-gray-900`, `bg-slate-900`
- Use backdrop `#060814` as the universal dark background

**6.3.2 — Fix WCAG AAA contrast on mobile**
- All text on dark backgrounds must achieve 7:1 contrast ratio
- Use lighter grays (`text-gray-300` minimum) for body text on dark
- Use `text-gray-400` only for labels, not body content

---

## Implementation Order (Dependency Graph)

```
Phase 0 (Emergency Security)
├── 0.1 Database fixes (can parallelize)
├── 0.2 Web security fixes (can parallelize)
├── 0.3 Mobile security fixes (can parallelize)
└── 0.4 Shared package fixes (must complete before 0.2/0.3)

Phase 1 (Backend Hardening) — depends on Phase 0
├── 1.1 Schema (sequential: indexes → constraints → soft-delete → partitioning)
├── 1.2 RLS (depends on 1.1)
└── 1.3 Edge functions (can parallelize after 1.2)

Phase 2 (Web Transformation) — Phase 0.2 must be done; Phase 1.3 helpful
├── 2.1 Architecture (can start after Phase 0)
├── 2.2 Component refactoring (depends on 2.1)
├── 2.3 Design system (depends on 2.1)
└── 2.4 Performance (depends on 2.2)

Phase 3 (Mobile Rebuild) — Phase 0.3 must be done
├── 3.1 Expo config (independent)
├── 3.2 WatermelonDB wiring (depends on 3.1)
├── 3.3 Screen rebuild (depends on 3.2)
└── 3.4 Accessibility & design (depends on 3.3)

Phase 4 (Compliance) — Phase 1 must be done
├── 4.1 HIPAA (depends on Phase 1.2 RLS)
├── 4.2 Error handling (independent, can start after Phase 0)
├── 4.3 Testing (can start after Phase 2/3)
└── 4.4 Monitoring (independent)

Phase 5 (Enterprise Features) — Phases 1+2 must be done
├── 5.1 Billing (depends on 0.1 encryption fixes)
├── 5.2 AI insights (depends on 0.1 auth + 1.3 PHI stripping)
└── 5.3 Director analytics (depends on 2.4 performance)

Phase 6 (Polish) — Phases 2+3 must be done
├── 6.1 Design alignment (depends on 2.3 + 3.4)
├── 6.2 Animation (depends on 6.1)
└── 6.3 Dark mode (depends on 6.1)
```

---

## Success Criteria Verification

After each phase, verify:

### Phase 0: Emergency Security
- [ ] No user can set their own role to `admin`
- [ ] No user can INSERT into `audit_logs`
- [ ] `approve_case()` / `reject_case()` require supervisor+ role
- [ ] All edge functions require valid JWT
- [ ] No plaintext secrets in client bundle
- [ ] `btoa()` removed from de-identification flow
- [ ] Mobile auth tokens use `expo-secure-store`
- [ ] Mobile form uses Zod validation
- [ ] De-identification toggle exists on mobile
- [ ] Tenant isolation enforced in middleware

### Phase 1: Backend Hardening
- [ ] All required indexes exist (EXPLAIN ANALYZE on all dashboard queries)
- [ ] CHECK constraints prevent invalid `tier`, `status`, `region` values
- [ ] Soft-delete works on all critical tables
- [ ] `audit_logs` partitioned by month
- [ ] MRN hash salt in Vault, not migration SQL
- [ ] Webhook idempotency works (duplicate Stripe events ignored)
- [ ] Case status state machine enforced

### Phase 2: Web Transformation
- [ ] All pages have Error Boundaries and Suspense fallbacks
- [ ] CaseForm < 400 lines per file
- [ ] No `as any` or `as unknown as` casts
- [ ] No hardcoded hex colors (all use CSS variables)
- [ ] WCAG AAA contrast on all text
- [ ] Dashboard renders < 3s with 500 residents
- [ ] Cases page with cursor pagination (< 1s per page)

### Phase 3: Mobile Rebuild
- [ ] Case creation works fully offline (Airplane mode)
- [ ] Sync pulls updates within 30 seconds of reconnect
- [ ] Approval notifications arrive within 60 seconds
- [ ] De-identification toggle on mobile case form
- [ ] Zod validation on all mobile form submissions
- [ ] All screens show offline indicator

### Phase 4: Compliance
- [ ] No PHI in AI prompts
- [ ] No plaintext MRN/DOB in database `audit_logs.changes`
- [ ] Consent tracking table exists and works
- [ ] Data retention cron job runs weekly
- [ ] Sentry/Bugsnag reports no PHI
- [ ] RLS tests pass for all 5 roles + cross-tenant isolation

### Phase 5: Enterprise Features
- [ ] Stripe Checkout creates real payment sessions
- [ ] Webhook processes events idempotently
- [ ] Lapsed tenants see ReadOnlyBanner and cannot submit cases
- [ ] AI insights show disclaimer and enforce quotas
- [ ] Director dashboard loads < 3s with 500 residents

### Phase 6: Polish
- [ ] All mobile screens use `bg-backdrop` (#060814)
- [ ] Progress rings animate on mount
- [ ] All interactive elements have `accessibilityLabel`
- [ ] All text passes WCAG AAA (7:1 contrast)
- [ ] Haptic feedback on primary actions

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Supabase migration breaks existing data | Medium | Critical | Test all migrations on staging first; use `ALTER TABLE` instead of `DROP/CREATE` |
| WatermelonDB sync race conditions | High | High | Add mutex locks on push, use Supabase's `updated_at` timestamp conflict resolution |
| HeroUI v3 breaking changes | Low | Medium | Pin exact version; test in isolated branch |
| PHIPAA audit finds PHI in audit_logs | Medium | Critical | Sanitize `audit_logs.changes` to redact MRN/DOB when `is_deidentified = true` |
| Stripe webhook processing fails silently | Medium | High | Add idempotency key, structured logging, and alert webhook |
| Mobile offline sync conflicts corrupt data | Medium | High | Server-authoritative with user-facing conflict resolution UI |

---

## Files Changed Summary

Estimated: **80-100 files** modified across 6 phases.

| Area | Files Added | Files Modified | Files Removed |
|------|------------|---------------|---------------|
| Supabase migrations | 1 (00011_critical_fixes) + 2-3 more | 10 (all existing) | 0 |
| Edge functions | 2-3 new | 4 (all existing) | 0 |
| Web components | 5-7 new (skeletons, error boundaries, wizard steps) | 20+ (all existing) | 0 |
| Web pages | 2-3 new (health, error) | 12 (all existing) | 0 |
| Web config | 0 | 3 (next.config, tsconfig, globals.css) | 0 |
| Mobile screens | 2-3 new (ai-insights, case detail) | 5 (all existing) | 0 |
| Mobile lib | 1-2 new (encrypted storage, error boundary) | 4 (all existing) | 0 |
| Shared package | 1 new (database.server.ts) | 3 (all existing) | 0 |
| Tests | 10-15 new | 0 | 0 |