# Security & Compliance — Design Spec

**Date**: 2026-07-01
**Project**: E-Logbook Enterprise
**Status**: Approved design

---

## 1. Data Retention Enforcement

### Current State
- `enforce_data_retention()` RPC exists in migration 00013
- Soft-deletes expired records from `case_entries`, `consent_records`, `audit_logs`
- Never scheduled — runs only on manual invocation

### Changes
- Enable `pg_cron` extension in Supabase project
- Schedule the RPC daily at 02:00 UTC:
  ```sql
  SELECT cron.schedule('data-retention', '0 2 * * *', 'SELECT enforce_data_retention()');
  ```
- Add configurable retention period per tenant:
  - Add `data_retention_days integer default 365` column to `tenants` table (migration 00065)
  - Admin can configure in tenant settings UI
  - `enforce_data_retention()` reads per-tenant `data_retention_days` instead of hardcoded value

### Files
| File | Change |
|------|--------|
| `supabase/migrations/00065_data_retention.sql` | New — add column + schedule cron |
| `apps/web/app/[tenant]/settings/page.tsx` | Add retention period UI input |
| `supabase/migrations/00013_audit_phi_redaction.sql` | Update `enforce_data_retention()` to use per-tenant config |

---

## 2. Audit Log Export

### Current State
- `/audit` page exists, lists audit entries
- `/api/[tenant]/export-pdf` endpoint exists
- No export UI or date filtering

### Changes
Add export UI at `/audit` page (not a separate route):

| Widget | Description |
|--------|-------------|
| Date range picker | Start date + end date inputs, defaults to last 30 days |
| Event type filter | Multi-select: create, update, delete, approve, reject, all |
| Export buttons | CSV + PDF |

### Export Flows
- **CSV**: Client-side: fetch filtered data via Supabase query → convert to CSV using a simple `arrayToCsv()` utility → trigger download via `<a download>`
- **PDF**: POST to existing `/api/[tenant]/export-pdf` with audit data payload → receive PDF blob → download

### Files
| File | Change |
|------|--------|
| `apps/web/app/(authenticated)/[tenant]/audit/page.tsx` | Add date picker, filter, export buttons |
| `apps/web/app/(authenticated)/[tenant]/audit/export/route.ts` | New — API route for CSV export |
| `apps/web/lib/export-csv.ts` | New — `arrayToCsv()` helper |

---

## 3. Session Management

### Current State
- Supabase Auth handles sessions via `auth.sessions` table internally
- No UI for viewing/revoking sessions
- No concurrent session limit
- No forced logout on role change

### Changes

#### 3.1 Session List UI
- New "Active Sessions" card in `/settings` page
- Columns: device/browser, IP address, last active timestamp, revoke button
- Fetches from a new RPC `get_active_sessions(user_id)` that queries `auth.sessions`

#### 3.2 Session Revocation
- Revoke button calls `supabase.auth.admin.deleteUser()` for the specific session (uses service role)
- For non-admin users: custom RPC `revoke_session(session_id)` with RLS check that the session belongs to the requesting user

#### 3.3 Concurrent Session Limit
- Custom server-side check in `proxy.ts`:
  - Extract user from session cookie
  - Query count of active sessions for user from `auth.sessions`
  - If > 5, reject request with 429 and "Too many active sessions" message
  - Skip for API routes that need to work (health, callback)

#### 3.4 Forced Logout on Role Change
- When admin updates a user's role (in `UserManager.tsx`):
  - Call `supabase.auth.admin.deleteUser()` (with service role client)
  - This deletes ALL sessions for that user, forcing re-login
  - Show toast: "User's sessions revoked. They will need to log in again."

### Files
| File | Change |
|------|--------|
| `supabase/migrations/00065_session_management.sql` | New — `get_active_sessions` RPC, `revoke_session` RPC |
| `apps/web/app/(authenticated)/[tenant]/settings/page.tsx` | Add active sessions card |
| `apps/web/proxy.ts` | Add concurrent session check |
| `apps/web/components/UserManager.tsx` | Add session revocation on role change |
| `apps/web/components/SessionList.tsx` | New — session list component |

---

## 4. CSP Header Audit

### Current State
- `next.config.js` has CSP headers via `SecurityHeaders` middleware
- Uses Helmet-style header generation with `content-security-policy`

### Changes
- Add `report-uri` or `report-to` directive to CSP for violation reporting
- Add a `/api/csp-violation` endpoint that logs violations to audit_logs or a separate table
- Review existing directives against actual page resources (fonts, scripts, styles, connect-src)
- Specific known gaps to verify:
  - `connect-src` includes Supabase URL, Stripe, Sentry, PostHog, Vercel analytics
  - `font-src` includes Google Fonts, self
  - `img-src` includes Supabase storage, self, data:
  - `script-src` is strict (no 'unsafe-inline' for production)

### Files
| File | Change |
|------|--------|
| `apps/web/next.config.js` | Add `report-uri`, review all directives |
| `apps/web/app/api/csp-violation/route.ts` | New — CSP violation reporting endpoint |

---

## 5. Rate Limiting Hardening

### Current State
- `lib/rate-limit.ts` exists with a token bucket implementation
- Applied to some endpoints

### Changes
Apply rate limiting to all unauthenticated + authentication-related endpoints:

| Endpoint / Route | Limit | Window | Notes |
|-----------------|-------|--------|-------|
| POST `/auth/callback` | 10 | 60s | Auth exchange |
| POST (login form) | 5 | 60s | Login attempts |
| POST (password reset) | 3 | 300s | Reset requests |
| ALL `/api/*` (unauthenticated) | 30 | 60s | General API |
| ALL `/api/*` (authenticated) | 200 | 60s | General API |

Implemented at the `proxy.ts` middleware level so it applies before routes.

### Files
| File | Change |
|------|--------|
| `apps/web/proxy.ts` | Add rate limit checks per route pattern |
| `apps/web/lib/rate-limit.ts` | Add `checkRoute()` convenience wrapper |

---

## 6. Audit Logging Completeness Check

Audit all data mutations to verify they produce audit log entries:

| Mutation | Currently Logged? | Action |
|----------|------------------|--------|
| Case INSERT/UPDATE/DELETE | ✅ (trigger 00003/00013) | — |
| Goal INSERT/UPDATE/DELETE | ❌ | Add trigger |
| Template INSERT/UPDATE/DELETE | ❌ | Add trigger |
| Profile UPDATE (role change) | ❌ | Add trigger |
| Subscription status change | ❌ | Add application-level log |
| Invite creation | ❌ | Add application-level log |
| Settings change | ❌ | Add application-level log |

### Files
| File | Change |
|------|--------|
| `supabase/migrations/00067_audit_gaps.sql` | New — triggers for goals, templates, profile updates |
| `apps/web/components/SubscriptionStatusProvider.tsx` | Log subscription changes |

---

## Migration Plan

| # | Migration | Purpose |
|---|-----------|---------|
| 00065 | `data_retention_config.sql` | Add `data_retention_days` to tenants, schedule cron |
| 00066 | `session_management.sql` | `get_active_sessions` RPC, `revoke_session` RPC |
| 00067 | `audit_gaps.sql` | Audit triggers for goals, templates, profile |
