# Dashboard & Case Management — Data-Fetch & State Reference

> Generated 2026-07-08. Every data fetch, RPC, query pattern, loading/empty/error/edge-case state,
> redirect/authorization check, and env var used by the dashboard and case management pages.

---

## 1. ENVIRONMENT VARIABLES

| Variable | Required | Used By | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | `server.ts`, `client.ts`, `middleware.ts` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | `server.ts`, `client.ts`, `middleware.ts` | Supabase anonymous key |
| `NEXT_PUBLIC_SITE_URL` | Yes | `csrf.ts`, `middleware.ts` | Trusted origin for CSRF guard |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Error boundaries, routes | Sentry client DSN |
| `NEXT_PUBLIC_SENTRY_ENV` | Optional | Sentry config | Environment tag |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Optional (0.2) | Sentry config | Performance tracing rate |
| `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | Optional (0.1) | Sentry config | Session replay rate |
| `NEXT_PUBLIC_POSTHOG_KEY` | Optional | `analytics.ts` | PostHog product analytics |
| `NEXT_PUBLIC_POSTHOG_HOST` | Optional | `analytics.ts` | PostHog host |
| `UPSTASH_REDIS_REST_URL` | Optional | `rate-limit-redis.ts` | Redis-backed rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | `rate-limit-redis.ts` | Redis auth token |
| `SENTRY_DSN` | Optional | `sentry.server.config.ts` | Server-side Sentry DSN |

---

## 2. AUTHENTICATION & AUTHORIZATION FLOW

### 2.1 `getAuthContext()` (`lib/supabase/auth.ts`)

**Source**: React `cache()`-wrapped server function. Called by EVERY page.

**Queries executed (parallel via `Promise.all`)**:

| # | Table / Method | Select | Filter | Single? |
|---|----------------|--------|--------|---------|
| 1 | `auth.getUser()` | user id, email | — | yes |
| 2 | `profiles` | `id, tenant_id, role, full_name, specialty, onboarding_completed` | `user_id = auth.user.id` | `.single()` |
| 3 | `tenants` | `id, slug, tenant_type` | `id = profile.tenant_id` | `.single()` |
| 4 | `subscriptions` | `status, plan_id, current_period_end` | `tenant_id = profile.tenant_id` | `.maybeSingle()` |
| 5 | `auth.mfa.getAuthenticatorAssuranceLevel()` | current AAL level | — | — |

**Result shape** (`AuthResult`):

```typescript
{
  user: { id: string; email?: string };
  profile: { id; tenant_id; role: UserRole; full_name; specialty; onboarding_completed };
  tenant: { id; slug; tenant_type };
  subscription: { status; plan_id; current_period_end } | null;
  aal: 'aal1' | 'aal2';
  mfaRequired: boolean; // true when role in ['director','institution_admin','admin'] AND aal !== 'aal2'
}
```

**Error states**:
- `auth.getUser()` fails → throws `'Not authenticated'`
- Profile not found → throws `'Profile not found: ...'`
- Tenant not found → throws `'Tenant not found: ...'`

### 2.2 `canAccessTenant()` (`lib/supabase/auth.ts`)

Simple check: `auth.tenant.slug === requestedTenantSlug`. No cross-tenant access (admin_tenants join table planned but not yet implemented per P4.8).

### 2.3 MFA Roles

`MFA_REQUIRED_ROLES = ['director', 'institution_admin', 'admin']` — these roles are redirected to `/mfa/verify` if not at AAL2.

---

## 3. TENANT LAYOUT (`layout.tsx`)

**File**: `(authenticated)/[tenant]/layout.tsx`

### Auth checks (sequential):
1. `getAuthContext()` — if throws → redirect `/login`
2. `!auth.profile.onboarding_completed` → redirect `/onboarding` (P6.1)
3. `!canAccessTenant(auth, paramTenant)` → redirect `/{auth.tenant.slug}/dashboard`
4. `auth.mfaRequired` → redirect `/{auth.tenant.slug}/mfa/verify?next=/{slug}/dashboard`

### Data passed to providers:
- `subscriptionStatus`: from `auth.subscription?.status ?? 'active'`
- `periodEnd`: from `auth.subscription?.current_period_end`
- Visible nav links: filtered from `NAV_LINKS` by `userRole`

### Role-based routing (NAV_LINKS):
- `/dashboard`: all roles (resident, supervisor, director, institution_admin, admin)
- `/cases`: resident, supervisor
- `/approvals`: supervisor, director, admin
- `/goals`: resident, director, admin
- `/reports`: all roles
- `/evaluate`: supervisor, director, institution_admin, admin
- `/billing`: resident, admin
- `/analytics`: director, institution_admin, admin
- `/audit`: director, institution_admin, admin
- `/compliance`: director, institution_admin, admin
- `/admin`: director, institution_admin, admin
- `/settings`: all roles

### Loading state (`loading.tsx`):
- Two `CardSkeleton` components with shimmer

### Error boundary (`error.tsx`):
- "Something went wrong" + red icon + Try again button + error digest reference

---

## 4. DASHBOARD PAGE (`dashboard/page.tsx`)

### 4.1 Authorization

```typescript
const auth = await getAuthContext();
if (auth.tenant.slug !== tenantSlug) redirect('/login');
```

### 4.2 Data Fetches (Server Component)

**All queries are parallel via `Promise.all(queries)`**.

| Index | Table | Select | Filter | Order/Limit | Notes |
|---|---|---|---|---|---|
| 0 | `case_entries` | `id, case_date, status` + `case_templates!inner(name, specialty)` | `tenant_id`, + `resident_id` if resident | `created_at DESC`, limit 5 | Director+ also selects `resident_id` |
| 1 | `program_goals` | `id, title, target_count, deadline, specialty` | `resident_id`, `tenant_id` | — | Always fetched |
| 2 (if resident) | `goal_progress` | `goal_id, current_count` | `resident_id` | — | Only for resident role |
| 3 (if resident) | `duty_weekly_violations` | `week_start, total_hours` | `resident_id` | `week_start DESC` | Only for resident role |
| 2/3/4 if director+ | `profiles` | `id, full_name, specialty` | `tenant_id`, `role='resident'` | — | All residents in tenant |
| 3/4/5 if director+ | `duty_weekly_violations` | `resident_id, week_start, total_hours` | `tenant_id` | `week_start DESC` | All violations in tenant |

**Index calculation complexity**: The array index for each result depends on the role (resident vs director+) — dynamic offset calculation with potential bugs (4 variants of index math).

### 4.3 Stats Queries (director+ only)

Four COUNT queries run in parallel via `Promise.all` (`{ count: 'exact', head: true }` — no row data, just counts):

| Table | Filter | Count column |
|---|---|---|
| `case_entries` | `tenant_id`, `status='pending'`, `deleted_at IS NULL` | `id` |
| `case_entries` | `tenant_id`, `status='approved'`, `deleted_at IS NULL` | `id` |
| `case_entries` | `tenant_id`, `status='rejected'`, `deleted_at IS NULL` | `id` |
| `case_entries` | `tenant_id`, `status='draft'`, `deleted_at IS NULL` | `id` |

**For residents**: stats are computed client-side by tallying the (capped-to-5) `allCaseRows`.

### 4.4 Component Data Shape

```typescript
interface DashboardData {
  profile: { id; role; full_name; specialty; tenant_id };
  tenantSlug: string;
  stats: { draft; pending; approved; rejected };
  recentCases: Array<{ id; case_date; status; template_name; template_specialty }>;
  goals: Array<{ id; title; current; target; deadline; specialty }>;
  residents: Array<{ id; full_name; specialty; total_cases; approved }>;
  pendingApprovals: number;
  totalResidents: number;
  tenantType: 'individual' | 'institution';
  residentViolations: ViolationRow[];
  directorViolations: ViolationRow[];
}
```

### 4.5 Rendering States (DashboardContent.tsx — Client Component)

| Section | Role Access | Empty State | Data State | Edge Cases |
|---|---|---|---|---|
| **Header** | All | N/A | Shows "Welcome, {firstName}" + role subtitle | `split(' ')[0]` — breaks for single-name profiles |
| **KPI Rings** | All | All zero → rings show "0" with 0% progress | 4 animated SVG rings per status | `max=totalCases || 1` to avoid div-by-zero |
| **Duty Hour Violations** | All (different data) | Hidden entirely when length === 0 | Red warning card with violation rows | Resident sees own; director+ sees all by resident name |
| **Recent Cases** | All | EmptyState: "No cases logged yet" + action to create | Cases list with specialty — name, date, status badge | max 5 items, "View All" link to /cases |
| **Goal Progress** | Resident only | EmptyState: "No goals assigned yet" + link to /goals | Progress bars with animated fill widths | Empty only if goals array is empty |
| **Pending Approvals** | Supervisor+ | EmptyState: "All caught up" | Orange card with count + "Review All" link | Shows `stats.pending` count for director+ |
| **Resident Overview** | Director+ only (institution) | Hidden if no residents (array empty) | Resident list: name, specialty, approved/total | Capped to 8 items, scrollable |
| **Quick Links** | All (approvals link hidden for resident) | N/A | 4 tiles: Cases, Approvals, Goals, Reports | Approvals tile hidden for resident role |
| **Log New Case CTA** | Resident only | N/A | Button linking to /cases/new | Disabled+gray when `isReadOnly` (subscription lapsed) |

### 4.6 Loading State (`dashboard/loading.tsx`)

Matching Suspense fallback: 4 KPI skeletons → 2 content skeletons → 4 link skeletons.

---

## 5. CASES LIST PAGE (`cases/page.tsx`)

### 5.1 Authorization

```typescript
const auth = await getAuthContext();
if (auth.tenant.slug !== tenantSlug) redirect('/login');
```

### 5.2 Search Params

| Param | Type | Default | Purpose |
|---|---|---|---|
| `page` | string (parsed int) | 1 | Pagination offset; clamped to `Math.max(1, ...)` |

### 5.3 Data Fetch

| Table | Select | Filter | Order/Limit |
|---|---|---|---|
| `case_entries` | `id, case_date, patient_mrn, status, resident_id, case_templates!inner(name, specialty)` with `{ count: 'exact' }` | `tenant_id` (+ `resident_id` if resident) | `created_at DESC`, `.range(offset, offset + PAGE_SIZE - 1)` where `PAGE_SIZE = 20` |

### 5.4 Rendering States

| State | Handling |
|---|---|
| **Database error** | Returns page with `<ErrorDisplay message={error.message} />` — shows user-friendly message + technical details expandable |
| **Empty** (`!entries || entries.length === 0`) | `<EmptyState>`: folder icon, "No cases logged yet", "Log your first case" CTA |
| **Data** | Table with columns: Case (specialty — name), MRN, Status, Actions |
| **Pagination** | Bottom nav: "Page X of Y" + Previous/Next buttons. Total pages = `Math.ceil((count || 0) / PAGE_SIZE)` |
| **Single-page** | Pagination hidden when `totalPages <= 1` |
| **First page** | No "Previous" button |
| **Last page** | No "Next Page" button |

### 5.5 Actions per row

| Action | Condition | Link |
|---|---|---|
| **View** | Always | `/{slug}/cases/{id}` |
| **Duplicate** | Only when `entry.resident_id === auth.profile.id` | `/{slug}/cases/new?duplicateFrom={id}` |

### 5.6 Loading State (`cases/loading.tsx`)

Title skeleton + filter bar skeleton (2 items) + CardSkeleton + TableSkeleton (5 cols × 8 rows).

### 5.7 Error Boundary (`cases/error.tsx`)

Client component. "Unable to load cases" + retry button + error digest.

---

## 6. CASE CREATE / NEW PAGE (`cases/new/page.tsx`)

### 6.1 Search Params

| Param | Type | Purpose |
|---|---|---|
| `duplicateFrom` | string | Case ID to duplicate (pre-fills form) |
| `repeatLast` | string (`'true'`) | Pre-fill from last submitted case |

### 6.2 Authorization & Subscription Checks

```typescript
// 1. Check auth
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect('/login');

// 2. Profile + tenant lookup (joined)
const { data: profile } = await supabase
  .from('profiles')
  .select('id, tenant_id, tenants!inner(slug, tenant_type)')
  .eq('user_id', user.id)
  .single();
if (!profile) redirect('/login');

// 3. Tenant slug match
const tenant = profile.tenants;
if (!tenant || tenant.slug !== tenantSlug) redirect('/login');

// 4. Subscription status check
const { data: subscription } = await supabase
  .from('subscriptions')
  .select('status')
  .eq('tenant_id', profile.tenant_id)
  .maybeSingle();
```

**Auth fetch**: `supabase.auth.getUser()` directly (does NOT use `getAuthContext()` — notable inconsistency).

### 6.3 Role Access

**No role-based filtering** on this page — any authenticated user can access. The form handles role differences internally.

### 6.4 Read-Only Guard

```typescript
const isReadOnly = subscription?.status === 'past_due' || subscription?.status === 'unpaid';
```

If read-only: renders an amber warning banner and does NOT render the form.

### 6.5 Initial Status Logic

```typescript
const initialStatus = tenant.tenant_type === 'individual' ? 'pending' : 'draft';
```

Individual users skip draft → pending workflow. Institution users start in draft.

### 6.6 Data Fetches (Client Component — CaseForm.tsx)

**On mount** (`useEffect` in CaseForm.tsx):

| # | Table | Select | Filter | Purpose |
|---|---|---|---|---|
| 1 | `case_templates` | `*` | `tenant_id` = current tenant | Tenant-specific templates |
| 2 | `case_templates` | `*` | `tenant_id` = GLOBAL_TENANT_ID | Global/shared templates |
| 3 | `auth.getUser()` | user id | — | For favorites & personal counts |
| 4 | `template_favorites` | `template_id` | `user_id` = current user | Favorite template IDs |
| 5 | `profiles` | `id` | `user_id` = current user | Get profile ID |
| 6 | `case_entries` | `template_id` | `resident_id` = profile.id | Personal usage counts |
| 7 | `case_entries` | `template_id` | `tenant_id` | Tenant-wide usage counts |
| 8 | `accreditation_frameworks` | `*` | `tenant_id` | Accreditation frameworks |

All API calls are sequential within the `useEffect` — 6+ round trips on page load.

**On duplicate from existing case**:

| Table | Select | Filter | Notes |
|---|---|---|---|
| `case_entries` | `*` | `id` = `duplicateCaseId` | Full entry for pre-fill |

**On repeat last entry**:

| Table | Select | Filter | Notes |
|---|---|---|---|
| `profiles` | `id` | `user_id` | Resolve user → profile |
| `case_entries` | `*` | `resident_id`, status IN `['pending','approved']`, order by `created_at DESC`, limit 1 | Get most recent submitted entry |

### 6.7 Mutation: `hash_patient_mrn` RPC

Called before INSERT when `isDeidentified === true`:

```
supabase.rpc('hash_patient_mrn', { p_mrn: patientMrn, p_tenant_id: tenantId })
```

**DB definition**: `SECURITY DEFINER; authenticated + service_role`. Hashes MRN with tenant-specific salt: `SHA256(p_mrn || 'elogbook-mrn-salt-v1' || p_tenant_id)` (salt later made configurable via `current_setting('app.mrn_salt')`).

### 6.8 Mutation: `toggleFavorite`

| Action | Table | Condition |
|---|---|---|
| Add favorite | `template_favorites` INSERT | `{ user_id, template_id }` |
| Remove favorite | `template_favorites` DELETE | `user_id` AND `template_id` |

### 6.9 Insert: `case_entries` INSERT

**Fields**: `tenant_id, template_id, case_date, field_values, status, accreditation_mappings, is_deidentified, patient_mrn, patient_dob, patient_age_years, patient_hash`

**On success**: Shows success screen → redirect to `/{slug}/cases` or `/{slug}/cases/{id}`.

**DB-side triggers that fire**:
- `trg_auto_approve_individual` — auto-sets status='approved' for individual tenants
- `trg_update_goal_progress` — recalculates goal_progress
- `trg_block_lapsed_tenant_submit` — blocks insert for lapsed subscriptions (defense-in-depth)
- `trg_audit_case_entry` — PHI-stripped audit log

### 6.10 Form Validation (client-side)

`caseEntrySchema` (from `@elogbook/shared`) validates payload before submission. Step-level validation:

| Step | Validation |
|---|---|
| 0 (Template) | `selectedTemplateId` must be non-empty |
| 1 (Patient Info) | If de-identified: `patientAgeYears` must be numeric; else: `patientMrn` AND `patientDob` must be non-empty |
| 2 (Case Details) | `caseDate` must be non-empty |

### 6.11 Error States

- **Templates fail to load**: `errors` state set with `error.message`, template section renders `ErrorDisplay`
- **Favorites toggle fails**: `errors` state set, reverts optimistic UI
- **Form validation errors**: `errors` array populated with Zod issue messages
- **RPC hash failure**: Specific user-facing message
- **Insert failure**: Generic DB error message via `ErrorDisplay`
- **Loading**: Loading skeleton from `ClientCaseForm` (dynamic import)

### 6.12 Keyboard Shortcuts

| Key | Action |
|---|---|
| Enter (not textarea) | Next step / Submit |
| Shift+Enter (textarea) | Newline |
| Escape | Back step / Close confirm dialog |
| Enter (after submit) | Reset form for another entry |

---

## 7. CASE DETAIL PAGE (`cases/[id]/page.tsx`)

### 7.1 Authorization

```typescript
const auth = await getAuthContext();
if (auth.tenant.slug !== tenantSlug) redirect('/login');
```

Role-level access:
```typescript
const isResident = auth.profile.role === 'resident';
if (isResident && entry.resident_id !== auth.profile.id) notFound();
if (!isResident && entry.tenant_id !== auth.tenant.id) notFound();
```

### 7.2 Data Fetches

**Parallel**: Both queries run sequentially (await then await).

| # | Table | Select | Filter | Notes |
|---|---|---|---|---|
| 1 | `case_entries` | `*, case_templates(name, specialty, fields), profiles!case_entries_resident_id_fkey(full_name), tenants(tenant_type)` | `id` | `.single()` — full entry with joins |
| 2 | `approval_requests` | `*, profiles(full_name)` | `entry_id` = id | `.order('requested_at', { ascending: false })` |

### 7.3 Rendering States

| State | Handling |
|---|---|
| **Entry query error** | `<ErrorDisplay message={entryError.message} />` |
| **Entry not found** | `notFound()` — Next.js 404 page |
| **Access denied** | `notFound()` — hides existence from unauthorized users (no 403 distinction) |
| **Approvals query error** | `<ErrorDisplay message={approvalsError.message} />` |
| **No approvals** | Approval history section hidden entirely |
| **De-identified case** | Pending/amber banner: "Patient MRN and DOB are not stored" |
| **Identified case** | Danger/red PHI banner: "Handle with care per HIPAA" |
| **Draft status** | Shows "Submit for Approval" button (POST form to submit route) |

### 7.4 Submit Form

POST to `/{tenantSlug}/cases/{id}/submit` — server action via `<form>`.

Shows "Duplicate" button (links to `/{slug}/cases/new?duplicateFrom={id}`).

### 7.5 Loading State (`cases/[id]/loading.tsx`)

Title skeleton + 2 CardSkeleton components.

---

## 8. CASE SUBMIT ROUTE (`cases/[id]/submit/route.ts`)

**Method**: POST. Wrapped in `Sentry.startSpan({ name: 'cases.submit', op: 'http.server' })`.

### 8.1 Guard Stack (in order)

| # | Guard | Check | Error Response |
|---|---|---|---|
| 1 | **CSRF** | `validateOrigin(request, defaultTrustedOrigins(request))` | 403 |
| 2 | **Auth** | `supabase.auth.getUser()` | 401 |
| 3 | **Tenant match** | Profile's tenant slug vs URL param | 403 "Tenant mismatch" |
| 4 | **Rate limit** | `checkRateLimit('cases-submit:{userId}:{caseId}')` | 429 (30 req/min) |
| 5 | **Entry exists** | `case_entries` `.eq('id', id).single()` | 404 |
| 6 | **Status check** | `entry.status !== 'draft'` | 400 "Can only submit drafts" |
| 7 | **Ownership** | Resident must own case; supervisor+ can submit any | 403 |
| 8 | **Subscription** | `subscription.status` not past_due/unpaid | 403 |

### 8.2 Data Fetches (sequential within handler)

| # | Table | Select | Filter |
|---|---|---|---|
| 1 | `auth.getUser()` | user | — |
| 2 | `profiles` (with tenants join) | `tenant_id, tenants!inner(slug)` | `user_id` |
| 3 | `case_entries` | `id, tenant_id, resident_id, status` | `id` |
| 4 | `profiles` | `id, role` | `user_id` |
| 5 | `subscriptions` | `status` | `tenant_id` |

### 8.3 Mutation

1. **Update**: `case_entries` → `{ status: 'pending' }` WHERE id
2. **Read**: `tenants` → `tenant_type` (Check: individual → auto-approve, skip approval requests)
3. **Read**: `profiles` → `id` WHERE `tenant_id` AND role IN `['supervisor', 'director']` LIMIT 50
4. **Insert**: `approval_requests` — one per supervisor (pending status)

### 8.4 Error Recovery

If `approval_requests` insert fails:
- Rollback: `case_entries.update({ status: 'draft' })` WHERE id
- Return 500: "Failed to create approval requests. Case has been returned to draft."

### 8.5 Post-Submit

- If `tenant_type === 'individual'`: returns `{ success: true, auto_approved: true }` (no approval request created)
- Fires `dispatchWebhookEvent({ event_type: 'case.submitted' })` (best-effort async)

### 8.6 Rate Limiting (from `lib/rate-limit-redis.ts`)

- **Redis mode** (when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set): Upstash Redis sliding window
- **Local mode**: In-memory `Map` (single-instance only)
- Window: 60 seconds, max 30 requests per key
- Falls back to local on Redis error with console.warn

---

## 9. SHARED COMPONENTS

### 9.1 `SubscriptionStatusProvider` (Client Component)

**Props**: `status: SubscriptionStatus`, `periodEnd?: string | null`

**Computed values**:
- `isReadOnly`: `status === 'past_due' || status === 'unpaid'`
- `isGracePeriod`: same as `isReadOnly`
- `daysUntilSuspension`: based on 30-day grace period from `current_period_end`

**Default context fallback** (when used outside provider): `{ status: 'active', isReadOnly: false, ... }`

### 9.2 `ReadOnlyBanner` (Client Component)

Shows when `isReadOnly === true`. Links to `/{slug}/billing`. Shows suspension countdown if available.

### 9.3 `ErrorDisplay` (Client Component)

Takes `message: string` and optional `onRetry`. Uses `toUserMessage()` to map raw DB errors to user-friendly messages. Shows collapsible technical details.

### 9.4 `toUserMessage()` (from `lib/error-messages.ts`)

Pattern-matched error categorization:
- Postgres codes: 23505 (duplicate), 42501 (permission), 23503 (FK), 23514 (check), 22P02 (invalid input), 40001 (serialization), 40P01 (deadlock)
- Auth errors: EmailNotConfirmed, InvalidLoginCredentials, OtpExpired, SmtpError, UserAlreadyRegistered, RateLimitExceeded
- Network errors: Failed to fetch, NetworkError, timeout, abort

All unknown errors → generic "Something went wrong. Please try again. If the problem persists, contact support."

### 9.5 `EmptyState` (Client Component)

Props: `icon`, `title`, `description`, `action` (label + href/onClick), `secondaryAction`.

### 9.6 `Breadcrumbs` (Client Component)

Parses pathname, skips tenant slug segment. Links back to Dashboard as "Home". Non-terminal segments are clickable links; terminal segment is plain text. Returns null when on root tenant page (no crumbs).

---

## 10. MIDDLEWARE (`lib/supabase/middleware.ts`)

### CSRF Guard
- Blocks state-changing requests (POST/PUT/DELETE/PATCH) without matching Origin
- Trusted origins: request URL origin + `NEXT_PUBLIC_SITE_URL`
- Returns 403 JSON on mismatch

### Session Refresh
- Creates Supabase server client from cookie store
- Refreshes session if needed
- Proxy-style middleware that passes through if env vars are missing

---

## 11. DATABASE TABLES USED

| Table | Purpose | Accessed By |
|---|---|---|
| `case_entries` | Core case records | Dashboard, Cases list, Case detail, Case form, Submit route |
| `case_templates` | Template definitions (specialty, name, fields) | Dashboard, Cases list, Case detail, Case form |
| `profiles` | User profiles with roles | Dashboard, Case detail, Case form, Submit route, Layout |
| `tenants` | Tenant/slug info | Dashboard, Case form, Submit route, Layout |
| `subscriptions` | Subscription status | Dashboard, Case new, Submit route, Layout |
| `program_goals` | Resident program goals | Dashboard |
| `goal_progress` | Goal progress tracking | Dashboard |
| `duty_weekly_violations` | View: weekly duty hour violations >80h | Dashboard |
| `approval_requests` | Approval workflow records | Case detail, Submit route |
| `template_favorites` | User favorite templates | Case form |
| `accreditation_frameworks` | Accreditation framework config | Case form |

---

## 12. RPCs CALLED

| RPC | Parameters | Return | Called From | Purpose |
|---|---|---|---|---|
| `hash_patient_mrn` | `p_mrn: TEXT, p_tenant_id: UUID` | `TEXT` (SHA256 hex) | CaseForm.tsx | Hash MRN for de-identified cases |

---

## 13. EDGE CASES & KNOWN ISSUES

1. **Stats accuracy for residents**: Residents' stats are tallied client-side from the last 5 cases (capped fetch), not from a COUNT query. If a resident has >5 cases with mixed statuses, the counts under-report. Director+ uses accurate COUNT queries.

2. **Index math fragility**: The dynamic index calculation for parallel query results in `dashboard/page.tsx` (lines 120-131) uses complex conditional logic with 4 different index schemes depending on role combinations. A bug could silently return wrong data from the wrong query.

3. **getAuthContext() called 2-3 times per page**: Layout calls it, then each page calls it again. It's wrapped in React `cache()` so only one network round-trip happens, but the code pattern is confusing.

4. **Case new page uses raw `supabase.auth.getUser()`** instead of `getAuthContext()`, leading to 4 sequential DB queries (user → profile → tenant → subscription) where `getAuthContext()` would do it in parallel.

5. **Form loading waterfall**: CaseForm makes 6+ sequential DB calls in its initial `useEffect` (templates → user → favorites → profile → personal counts → tenant counts → accreditation frameworks). Could be optimized with `Promise.all`.

6. **No pagination on cases list without `?page=N`**: If URL is `/cases` with no page param, page defaults to 1. No URL-based status filter or search.

7. **notFound() for access denial**: Case detail page returns `notFound()` for unauthorized access (isResident + wrong owner) instead of a distinct 403. This prevents information leaking but also hides the distinction.

8. **`canProceed` for de-identified step 1**: Requires `patientAgeYears` to be numeric and non-empty, but `isDeidentified` doesn't require `patientMrn` — meaning you can proceed with a de-identified case without entering any identifier at all, which is correct behavior.

9. **Submit route rollback on approval failure**: If creating approval_requests fails halfway through, the entry is rolled back to 'draft' status. No compensation mechanism if the rollback itself fails.

10. **Subscription null case**: If `subscription` is null (no subscription record at all), `isReadOnly` is false, meaning unsubscribed tenants can still log cases. The DB trigger `trg_block_lapsed_tenant_submit` provides defense-in-depth.

11. **No env var latches**: If `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing, both `server.ts` and `client.ts` return a Proxy that throws on first method call. This is intentional to avoid build-time crashes.

12. **Dashboard goalProgressMap**: If `goalProgressMap[g.id]` is 0 (falsy), `|| 0` returns 0 (correct). If it's null/undefined, falls to 0 (also correct). No issue here.

13. **Duplicate clears fieldValues**: When a template is selected during duplication, `setSelectedTemplateId` calls `setFieldValues({})` first, then the duplication effect pre-fills them. There's a potential race where the duplicate hydration fires before the template change re-render, causing fields to be empty.

14. **Repeat last entry expects status IN ['pending', 'approved']**: If a resident's last entry was rejected or draft, it won't be used for repeat — correct behavior.
