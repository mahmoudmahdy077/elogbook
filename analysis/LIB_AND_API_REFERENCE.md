# E-Logbook Web App — Lib Files & API Routes Reference

> **Generated**: 2026-07-08 | **Source**: Web app lib/API agent (20+ lib files, 14 API routes, Sentry configs, middleware)

---

## 1. Supabase Clients

### `lib/supabase/client.ts`
- `createClient()` → singleton browser client with build-time safe Proxy
- **Env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Edge**: Proxy throws on first method call if env vars missing (not at import time)

### `lib/supabase/server.ts`
- `createServerSupabase()` → SSR client using `await cookies()` from `next/headers`
- Same build-time-safe Proxy pattern as client

### `lib/supabase/admin.ts`
- `createServiceRoleClient()` → admin client (no session, `autoRefreshToken: false`)
- **Env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### `lib/supabase/auth.ts`
| Export | Signature | Returns |
|--------|-----------|---------|
| `getAuthContext` | `cache(async () => ...)` | `{ user, profile, tenant, subscription, aal, mfaRequired }` |
| `canAccessTenant` | `(auth, requestedSlug) => boolean` | Strict slug equality |
| `isMfaRequiredForRole` | `(role) => boolean` | `director`, `institution_admin`, `admin` |

**Query pattern (3 sequential + 1 parallel)**:
1. `supabase.auth.getUser()`
2. `.from('profiles').select('...').eq('user_id', user.id).single()`
3. Parallel: `tenants.select()`, `subscriptions.select()`, `mfa.getAuthenticatorAssuranceLevel()`

### `lib/supabase/middleware.ts`
- `updateSession(request)` — Edge middleware logic
- `csrfGuard(request)` — Defense-in-depth CSRF for POST/PUT/DELETE/PATCH
- **Public routes**: `/`, `/login`, `/auth/*` (skip auth check)
- **Login redirect**: Already authenticated → redirect to dashboard
- **Tenant scope**: URL slug mismatch → redirect to correct dashboard

---

## 2. Utility Libraries

### `lib/pagination.ts`
- Cursor-based pagination for case_entries
- Composite cursor: `(created_at DESC, id DESC)`
- Base64 encoded JSON cursor
- `fetchCasesWithCursor(residentId, tenantId, cursor, pageSize)`

### `lib/csrf.ts`
- `validateOrigin(request, trustedOrigins?)` → Returns 403 response or null
- Two layers: middleware `csrfGuard` + per-route `validateOrigin`
- Origin header → Referer fallback → Set-based matching

### `lib/rate-limit.ts`
- In-memory sliding window (single-instance)
- `WINDOW_MS = 60000`, default `maxRequests = 30`
- `checkRateLimit(key, maxRequests?)` → sync
- `rateLimitResponse(retryAfter)` → 429 JSON

### `lib/rate-limit-redis.ts`
- Upstash Redis-backed with auto-fallback to local in-memory
- **Env vars**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `checkRateLimit(key, maxRequests?)` → async (returns Promise)
- Redis keys: `ratelimit:{key}:window`, `ratelimit:{key}:count`
- **Fallback**: On Redis error, `console.warn` then local in-memory

### `lib/request-context.ts`
- `AsyncLocalStorage<RequestContext>` from `node:async_hooks`
- Stores: requestId, route, method, userId, tenantId
- `newRequestId()` uses `crypto.randomUUID()`

### `lib/logger.ts`
- Structured JSON logger with PHI redaction (17+ PHI keys)
- Levels: debug, info, warn, error
- Browser: `navigator.sendBeacon('/api/log', ...)` for non-debug
- Node: `console.error` for warn/error, `console.log` for debug/info
- Enriches every line with requestContext

### `lib/safe-redirect.ts`
- `safeRelativePath(input)` — returns `'/'` for dangerous inputs
- Rejects: null/undefined, no leading `/`, `//` (protocol-relative), `/\\`

### `lib/error-messages.ts`
- `toUserMessage(raw)` — maps 13+ error patterns to user-friendly messages
- Falls back to "Something went wrong..."
- Calls `Sentry.captureMessage(raw, 'info')` before mapping
- Handles: PG codes (23505, 42501, etc.), Supabase auth errors, network errors

### `lib/analytics.ts`
- PostHog analytics with consent management
- **Env vars**: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- Cookie `analytics_consent` = `granted`|`denied`, 1 year
- Events: case_logged, case_submitted, case_approved, ai_query, subscription_started, mfa_enrolled

### `lib/webhooks.ts`
- HMAC-SHA256 signed webhook dispatch
- 5-second AbortSignal.timeout per webhook
- No retry — best-effort delivery
- Delivery logged to `tenant_webhook_deliveries`
- `testWebhookEndpoint(url, secret, tenantId)` — test ping

### `lib/performance.ts`
- Performance metrics collection (`MAX_METRICS = 1000`)
- `measureApiCall`, `measureSync`, `startTimer`, `getMetrics`, `getMetricStats`
- Auto-reports via `navigator.sendBeacon('/api/metrics')` on `pagehide`

---

## 3. Edge Middleware (`proxy.ts`)

**CSP**: Runtime nonce-based with `strict-dynamic`, secure defaults for all sources
**Rate limiting**: `auth-cb:{ip}`, `login:{ip}`, `api:{ip}` via rate-limit-redis
**Security headers (prod only)**: HSTS (2y), X-Content-Type-Options, Referrer-Policy, Permissions-Policy
**Matcher**: `/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)`

---

## 4. Sentry Config

### `sentry.server.config.ts` / `sentry.client.config.ts` / `sentry.edge.config.ts`
- Guarded by `NEXT_PUBLIC_SENTRY_DSN` (only init when set)
- `tracesSampleRate: 0.2` (configurable via env)
- `denyUrls`: `/api/auth/`, `/admin/`, `/login`, `/auth/callback`
- PHI scrubbing via `beforeSend`/`beforeSendTransaction` — strips cookies + scrubs `patient_mrn/dob/hash/field_values`
- Client adds: `replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`, `browserTracingIntegration()`
- Server adds: `autoInstrumentServerFunctions: true` via next.config.mjs

---

## 5. API Routes (14 routes)

| Route | Method | Auth | Rate Limit | CSRF | Key Pattern |
|-------|--------|------|------------|------|-------------|
| `/api/health` | GET | None | No | No | DB connectivity check |
| `/api/csp-violation` | POST | None | No | No | console.warn, 204 |
| `/api/[tenant]/admin/sso` | GET/POST | JWT | 20/min | Yes | Service role DB ops |
| `/api/[tenant]/admin/ai-config` | GET/POST | JWT | 20/min | Yes | Encrypted API key |
| `/api/[tenant]/admin/assign-role` | POST | JWT | 10/min | Yes | Profile update |
| `/api/[tenant]/admin/payment-gateway` | GET/POST | JWT | 20/min | Yes | Encrypted secrets |
| `/api/[tenant]/admin/webhooks` | GET/POST/DELETE | JWT | 20/min | Yes | Webhook CRUD |
| `/api/[tenant]/admin/webhooks/test` | POST | JWT | 10/min | Yes | Test ping |
| `/api/[tenant]/approvals/action` | POST | JWT | 20/min | Yes | RPC approve/reject |
| `/api/[tenant]/export-pdf` | GET | JWT | 30/min | No | Edge function + binary |
| `/api/[tenant]/compliance/export` | GET | JWT | 10/min | Yes | CSV/PDF |
| `/api/[tenant]/audit/export` | GET | JWT | 10/min | Yes | CSV/PDF + self-logging |
| `/[tenant]/cases/[id]/submit` | POST | JWT | 30/min | Yes | 8-layer auth chain |

**Common pattern**: CSRF → rate limit → auth → profile → tenant validation → role check → body parse → DB op

---

## 6. next.config.mjs

**Headers**: CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy, Permissions-Policy, Link preconnect, cache headers
**Sentry**: Auto-instrument server functions + middleware + app directory
**Images**: AVIF/WebP, SVG allowed with CSP sandbox, 24h cache
**Transpile**: `@elogbook/shared` for monorepo compatibility
**Bundle Analyzer**: Via `ANALYZE=true` env
