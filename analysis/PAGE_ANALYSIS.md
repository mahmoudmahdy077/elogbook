# Page Analysis: Approvals · Goals · Reports · Billing

Analyzed across the following file tree:
```
apps/web/app/(authenticated)/[tenant]/
├── approvals/
│   ├── page.tsx        (server component)
│   ├── loading.tsx     (route loading fallback)
│   └── error.tsx       (route error boundary)
├── goals/
│   ├── page.tsx        (server component)
│   └── loading.tsx     (route loading fallback)
├── reports/
│   ├── page.tsx        (server component)
│   ├── loading.tsx     (route loading fallback)
│   ├── error.tsx       (route error boundary)
│   └── duty-hours/
│       └── page.tsx    (server component)
└── billing/
    ├── page.tsx        (server component)
    └── loading.tsx     (route loading fallback)
```

Plus all downstream dependencies: shared components, API route handlers, utility libraries.

---

## 1. APPROVALS (`/approvals/page.tsx`)

### Architecture
**Server page** (RSC) → renders `<ApprovalsDashboard />` **client component** that does all data fetching on mount.

### Exports
- **None** from this page itself. The "Export" flows go through API routes: none exist specifically for approvals (no CSV/PDF for pending approvals).

### Data Fetches

**Server side** (page.tsx):
| Table | Select | Filter | Purpose |
|---|---|---|---|
| `supabase.auth.getUser()` | user | — | Auth gate |
| `profiles` | `id, role, tenant_id` | `eq('user_id', user.id)` .single() | Profile lookup + role check |

**Client side** (ApprovalsDashboard.tsx — runs in `useEffect` on mount):
| Table | Select | Filter | Purpose |
|---|---|---|---|
| `case_entries` | all fields + `profiles:resident_id(full_name, specialty)` + `case_templates:template_id(specialty, name)` | `eq('tenant_id', tenantId)` `eq('status', 'pending')` | Pending entries list |
| `case_entries` | `id` (count: exact, head: true) | `eq('tenant_id', tenantId)` | Total count for approval rate |
| `case_entries` | `id` (count: exact, head: true) | `eq('tenant_id', tenantId)` `eq('status', 'approved')` | Approved count |
| `approval_requests` | `id, status, requested_at, comment, entry_id` | `in('entry_id', entryIds)` | Approval requests for each pending entry |

**Note**: The client-side `useEffect` fetches data every time `tenantId` changes (no refetch mechanism, no polling, no SWR/react-query — raw `useEffect`).

### RPC Calls
- **None from the page**. The `ApprovalActions` child component calls:
  - `POST /api/{tenant}/approvals/action` → server route calls **`supabase.rpc('approve_case' | 'reject_case', { p_entry_id, p_supervisor_id, p_comment })`**

### States

| State | Where | Trigger | Rendering |
|---|---|---|---|
| **Loading** | `/approvals/loading.tsx` (route fallback) | Initial page navigation | Title skeleton + 4 filter chip skeletons + 3 CardSkeleton + TableSkeleton(4 cols, 6 rows) |
| **Loading (client)** | ApprovalsDashboard `if (loading)` | Before fetch resolves | "Loading..." text in bordered card |
| **Empty** | ApprovalsDashboard `entries.length === 0` | No pending entries | `<EmptyState>` with checkmark icon, "No pending approvals" |
| **Error** | ApprovalsDashboard `if (error)` | Any fetch fails | `<ErrorDisplay message={error} onRetry={fetchPending}>` |
| **Error (route)** | `/approvals/error.tsx` | Unhandled error thrown | Red-tinted error card with "Unable to load approvals", error.digest, retry button calling `reset()` |
| **Data** | entries mapped | Successful fetch | KPI cards + AnimatePresence list of approval cards with approval actions |

### Authorization Checks
| Check | Where | Behaviour on failure |
|---|---|---|
| `user` exists | page.tsx L8-9 | `notFound()` |
| `profile.role` in `['supervisor', 'director', 'admin']` | page.tsx L17-18 | `notFound()` |
| Tenant access | Layout (`canAccessTenant`) | Redirect to own tenant |
| Onboarding | Layout L49-51 | Redirect to `/onboarding` |
| MFA (director/admin) | Layout L60-62 | Redirect to `/mfa/verify` |
| API: CSRF origin | `POST /api/.../approvals/action` | 403 JSON |
| API: Rate limit (20/min/IP) | action route | 429 via `rateLimitResponse` |
| API: Auth | action route | 401 JSON |
| API: Role `['supervisor','director','institution_admin','admin']` | action route | 403 JSON |
| API: Tenant match | action route | 403 JSON |
| API: Entry belongs to tenant | action route | 403 JSON |

---

## 2. GOALS (`/goals/page.tsx`)

### Architecture
**Server page** (RSC) — no client-side fetch.

### Exports
- **None**. No export CSV/PDF routes for goals.

### Data Fetches (all server-side)

| Table | Select | Filter | Purpose |
|---|---|---|---|
| `getAuthContext()` | user + profile + tenant + subscription + aal | — | Auth context (cached) |
| `program_goals` | `*, goal_progress(current_count), profiles!resident_id(full_name)` | `eq('tenant_id', auth.profile.tenant_id)` | All goals for tenant |
| `program_goals` _(conditional)_ | same | + `eq('resident_id', auth.profile.id)` | When role is NOT director/admin — scope to self |
| `profiles` _(conditional)_ | `id, full_name` | `eq('tenant_id', auth.profile.tenant_id)` | Only when `isDirector` — populate resident dropdown |

**Note**: `getAuthContext()` itself makes 6 Supabase calls internally (user, profile, tenant, subscription, MFA AAL).

### RPC Calls
- **None directly from the page**. The `GoalForm` client component calls:
  - `supabase.from('program_goals').insert({...}).select('id').single()` (client-side via `createClient()`)
  - `supabase.from('goal_progress').insert({...})` (client-side via `createClient()`)

### States

| State | Where | Trigger | Rendering |
|---|---|---|---|
| **Loading** | `/goals/loading.tsx` (route fallback) | Initial page nav | H1 skeleton + 2× CardSkeleton |
| **Error (fetch)** | page.tsx L36-38 | `goalsError` | `<ErrorDisplay message={goalsError.message}>` |
| **Error (residents fetch)** | page.tsx L46-48 | `residentsError` (only for directors) | `<ErrorDisplay message={residentsError.message}>` |
| **Error (form)** | GoalForm.tsx L50-52 | Zod validation failure | Inline `<ErrorDisplay>` in modal |
| **Error (insert)** | GoalForm L73-76, L88-90 | DB insert fails | Inline `<ErrorDisplay>` in modal |
| **Empty** | page.tsx L69-78 | `typedGoals.length === 0` | `<EmptyState>` with checkmark icon, contextual title |
| **Data** | goals mapped | Successful fetch | Grid of goal cards with progress bars |
| **Overdue** | per-goal badge | `deadline < now && current < target` | "Overdue" red text |
| **Complete** | per-goal badge | `current >= target` | "Goal completed!" green text + green bar |

### Authorization Checks
| Check | Where | Behaviour on failure |
|---|---|---|
| `getAuthContext()` throws | page L20 | Propagates to nearest error boundary (layout or route) |
| Role-based data scope (`isDirector`) | page L30-32 | Non-directors only see their own goals |
| Role-based UI (`isDirector`) | page L60-66 | Only directors see "New Goal" button + resident selector |
| Tenant access | Layout | Redirect to own tenant |
| MFA | Layout | Redirect to `/mfa/verify` |

---

## 3. REPORTS (`/reports/page.tsx` + `/reports/duty-hours/page.tsx`)

### Architecture
**Server page** (RSC) — all data fetched server-side, no client fetch.

### Exports
| Export | Link/Route | Format | Data Source |
|---|---|---|---|
| **PDF** | `/api/{tenantSlug}/export-pdf` | PDF (via Supabase edge function) | `case_entries` (approved, own) |
| **CSV — Specialty** | `/api/{tenantSlug}/reports/specialty.csv?date_from=&date_to=` | CSV | `case_entries` + `case_templates!inner(specialty)` |
| **CSV — Status** | `/api/{tenantSlug}/reports/status.csv?date_from=&date_to=` | CSV | `case_entries` |
| **CSV — Evaluations** | `/api/{tenantSlug}/reports/evaluations.csv?date_from=&date_to=` | CSV | `faculty_evaluations` (blocked for `resident` role) |
| **CSV — Duty Hours** | `/api/{tenantSlug}/reports/duty-hours.csv?date_from=&date_to=` | CSV | `duty_periods` |

### Data Fetches (server side)

**Reports main page** (`/reports/page.tsx`):
| Table | Select | Filter | Purpose |
|---|---|---|---|
| `supabase.auth.getUser()` | user | — | Auth gate |
| `profiles` | `id, user_id, role, tenant_id, tenants!inner(slug, tenant_type)` | `eq('user_id', user.id)` .single() | Profile + tenant slug validation |
| `case_entries` | `*` (count: exact, head) | `eq('tenant_id', ...)` ± optional status ± date range | **4 queries** × (total, approved, pending, draft) = 4 count queries |
| `faculty_evaluations` | `resident_id, clinical_skills, professionalism, procedures` | `eq('tenant_id', ...)` | Evaluation averages |
| `case_entries` | `id, status, case_templates!inner(specialty)` | `eq('tenant_id', ...)` ± date range .limit(1000) | Specialty + status distribution |

**Duty hours sub-page** (`/reports/duty-hours/page.tsx`):
| Table | Select | Filter | Purpose |
|---|---|---|---|
| `getAuthContext()` | user + profile + tenant + subscription + aal | — | Auth context |
| `duty_periods` | `shift_date, hours_worked, shift_type` | `eq('tenant_id', tenantId)` ± `eq('resident_id', ...)` for residents ± date range .limit(100) | Duty hours data |

**PDF export route** (`/api/{tenant}/export-pdf/route.ts`):
| Table | Select | Filter | Purpose |
|---|---|---|---|
| `case_entries` | `id` | `eq('tenant_id', ...)` `eq('resident_id', ...)` `eq('status', 'approved')` | Get approved case IDs |
| Edge function call | POST to `generate-pdf` | — | Generate actual PDF |

**CSV export routes** (each does own auth + fetch):
| Route | Table | Select | Filter | Role check |
|---|---|---|---|---|
| `specialty.csv` | `case_entries` + `case_templates!inner(specialty)` | `specialty, status` | tenant + date .limit(1000) | Generic auth only |
| `status.csv` | `case_entries` | `status` | tenant + date .limit(1000) | Generic auth only |
| `evaluations.csv` | `faculty_evaluations` | full row + comments | tenant + date .limit(1000) | **Blocks `resident` role** (403) |
| `duty-hours.csv` | `duty_periods` | `resident_id, shift_date, hours_worked, shift_type` | tenant + date .limit(1000), scoped if resident | Generic auth only |

### RPC Calls
- **None on the page**. Export PDF route calls `supabase.functions.invoke()` (via raw fetch to edge function).

### States

| State | Where | Trigger | Rendering |
|---|---|---|---|
| **Loading** | `/reports/loading.tsx` (route) | Initial nav | H1 skeleton + 2× CardSkeleton |
| **Loading (duty-hours)** | `duty-hours/` has no loading.tsx — falls back to `/reports/loading.tsx` | Initial nav | Same skeleton |
| **Error (evaluations)** | page L47 | `evalError` | `<ErrorDisplay message={evalError.message}>` |
| **Error (entries)** | page L73 | `entriesError` | `<ErrorDisplay message={entriesError.message}>` |
| **Error (export route)** | API route | Various (see below) | JSON error response |
| **Error (route)** | `/reports/error.tsx` | Unhandled error | Red error card, "Unable to load reports", retry button via `reset()` |
| **Empty specialty** | page L186 | No `speciatyCounts` | "No cases logged yet." |
| **Empty payments** | billing | No payments | "No payments recorded yet." |
| **Auth gate** | page L10-L12 | No user | `redirect('/login')` |
| **Auth gate** | page L20-L23 | No profile | `redirect('/login')` |
| **Tenant mismatch** | page L23 | Slug mismatch | `redirect('/login')` |
| **Resident restricted** | page L235 | `profile.role === 'resident'` | Evaluation Averages section hidden |
| **Data** | All KPIs rendered | Successful all fetches | 4 KPI cards + specialty bar chart + status distribution + evaluation averages |

### Authorization Checks
| Check | Where | Behaviour on failure |
|---|---|---|
| `user` exists | page L10-12 | `redirect('/login')` |
| `profile` exists | page L20 | `redirect('/login')` |
| `tenant.slug` matches URL param | page L23 | `redirect('/login')` |
| Evaluation averages visible | page L235 | Hidden if role === `resident` |
| CSV export: auth | each CSV route | 401 JSON |
| CSV export: tenant match | each CSV route | 403 JSON |
| CSV export: resident block (evaluations only) | evaluations.csv route | 403 JSON |
| PDF export: auth | route | 401 JSON |
| PDF export: tenant match | route | 403 JSON |
| PDF export: rate limit (per user) | route via `checkRateLimit` | 429 |
| Tenant access + onboarding + MFA | Layout | Redirects as above |

---

## 4. BILLING (`/billing/page.tsx`)

### Architecture
**Server page** (RSC) — all data fetched server-side, then passes to a client component (`ClientSubscriptionPlans` → `SubscriptionPlans`) for the interactive subscription management.

### Exports
- **None**. No CSV/PDF exports on the billing page.

### Data Fetches (all server-side)

| Table | Select | Filter | Purpose |
|---|---|---|---|
| `getAuthContext()` | user + profile + tenant + subscription + aal | — | Auth context |
| `subscription_plans` | `*` | `eq('tenant_type', auth.tenant.tenant_type)` `order('price_monthly')` | Available plans for this tenant type |
| `subscriptions` | `*, plan:subscription_plans(*)` | `eq('tenant_id', ...)` `eq('status', 'active')` .maybeSingle() | Current active subscription |
| `payment_gateway_config` | `*` | `eq('tenant_id', ...)` `eq('is_active', true)` .maybeSingle() | Payment gateway credentials |
| `one_time_purchases` | `*` | `eq('resident_id', auth.profile.id)` `eq('purchase_type', 'ai_report')` `.order('created_at', DESC)` | AI report purchase history |
| `case_entries` | count (exact, head) | `eq('tenant_id', ...)` `is('deleted_at', null)` | Usage stat |
| `profiles` | count (exact, head) | `eq('tenant_id', ...)` | Usage stat (team members) |
| `payments` | `*` | `eq('tenant_id', ...)` `.order('created_at', DESC)` `.limit(10)` | Recent payment history |

### RPC Calls
- **None from the page**. The `SubscriptionPlans` client component calls:
  - `supabase.functions.invoke('create-checkout', { body: { tenant_id, plan_id, gateway } })` — Supabase Edge Function for Stripe checkout

### States

| State | Where | Trigger | Rendering |
|---|---|---|---|
| **Loading** | `/billing/loading.tsx` (route) | Initial nav | H1 skeleton + 2× CardSkeleton |
| **Loading (plans)** | ClientSubscriptionPlans dynamic import | SSR disabled — skeleton shown | Animated gradient blocks |
| **Error (plans)** | page L25 | `plansError` | `<ErrorDisplay message={plansError.message}>` |
| **Error (subscription)** | page L33 | `subscriptionError` | `<ErrorDisplay message={...}>` |
| **Error (gateway)** | page L41 | `gatewayError` | `<ErrorDisplay message={...}>` |
| **Error (purchases)** | page L49 | `purchasesError` | `<ErrorDisplay message={...}>` |
| **Error (case count)** | page L56 | `caseCountError` | `<ErrorDisplay message={...}>` |
| **Error (resident count)** | page L62 | `residentCountError` | `<ErrorDisplay message={...}>` |
| **Error (payments)** | page L70 | `paymentsError` | `<ErrorDisplay message={...}>` |
| **Error (subscription plans)** | SubscriptionPlans.tsx L66-71 | No plans returned | "No plans available." |
| **Error (checkout)** | SubscriptionPlans.tsx L98-99 | Checkout fails | `<ErrorDisplay>` in plan cards |
| **Empty payments** | billing page L150-151 | No payments | "No payments recorded yet." |
| **Empty purchases** | billing page L183-184 | No AI report purchases | "No AI report purchases yet." |
| **Data (current plan)** | page L108-132 | Subscription exists | Current plan card with name, price, status badge, next billing date |
| **Data (usage)** | page L134-146 | Any | "Cases Logged" + "Team Members" counts in grid |
| **Data (payment history)** | page L148-167 | Payments exist | List of payment items with amount, date, StatusBadge |
| **Data (plan cards)** | page L169-175 | Plans exist | Passed to `ClientSubscriptionPlans` for interactive rendering |
| **Data (AI purchases)** | page L177-199 | Purchases exist | List of purchase items with amount, date, PurchaseBadge |
| **Data (processing)** | SubscriptionPlans.tsx | `loadingPlanId !== null` | "Processing..." button state |

**Error propagation note**: The billing page has **7 independent Supabase queries** — any one failing renders an `<ErrorDisplay>` inline for that specific section, but the rest of the page continues to render. This is unique; other pages halt on first error.

### Authorization Checks
| Check | Where | Behaviour on failure |
|---|---|---|
| `getAuthContext()` throws | page L14 | Propagates to nearest error boundary |
| `auth.tenant.slug !== tenantSlug` | page L16 | `redirect('/login')` |
| Tenant access | Layout | Redirect to own tenant |
| MFA | Layout | Redirect to `/mfa/verify` |

---

## 5. CROSS-CUTTING CONCERNS

### Shared Utilities

| Utility | What it does | Used by |
|---|---|---|
| `getAuthContext()` | Fetches user, profile, tenant, subscription, MFA level — cached via React's `cache()` | goals, duty-hours, billing |
| `createServerSupabase()` | Creates Supabase server client with cookie-based SSR | approvals, reports, billing, all API routes |
| `createClient()` | Creates Supabase browser client | ApprovalsDashboard, GoalForm, SubscriptionPlans |
| `canAccessTenant()` | Compares `auth.tenant.slug === requestedSlug` | Layout |

### Shared Components Serving These Pages

| Component | Type | Used By | Props |
|---|---|---|---|
| `<EmptyState>` | Client | ApprovalsDashboard, Goals | icon, title, description, action, secondaryAction |
| `<ErrorDisplay>` | Client | All 4 pages | message, onRetry |
| `<CardSkeleton>` | Client (loading) | All 4 loading files | — |
| `<TableSkeleton>` | Client (loading) | Approvals loading | rows, columns |
| `<StatusBadge>` | Shared pkg | ApprovalsDashboard | — |
| `<ApprovalActions>` | Client | ApprovalsDashboard | requestId, entryId, tenant |
| `<GoalForm>` | Client | Goals page | tenantId, directorId, residents |
| `<DutyHoursChart>` | Client | Duty-hours report | periods |
| `<ClientSubscriptionPlans>` | Client (dynamic) | Billing | plans, tenantId, gatewayProvider, publishableKey, currentPlanId |
| `<SubscriptionPlans>` | Client (lazy) | Billing via ClientWrapper | Same |
| `<SubscriptionStatusProvider>` | Client | Layout wrapper | status, periodEnd |
| `<ReadOnlyBanner>` | Client | Layout | tenantSlug |
| `<ErrorBoundary>` | error.tsx | approvals, reports | error, reset |

### Loading State Hierarchy

```
Layout (force-dynamic) → [loading.tsx] → Page → [client loading]
```

- **Layout** has no loading boundary of its own; it blocks on `getAuthContext()`. If that throws, it redirects to `/login`.
- **Each route** has its own loading.tsx (static skeleton).
- **Client components** have additional loading states inside them.
- **Error boundaries** at route level (error.tsx for approvals and reports; goals and billing have none).

### API Routes (for these four pages)

| Route | Method | Auth | Rate Limit | Purpose |
|---|---|---|---|---|
| `/api/{tenant}/approvals/action` | POST | JWT + CSRF + role + tenant | 20/min/IP | Approve/reject case |
| `/api/{tenant}/export-pdf` | GET | JWT + tenant + rate limit | per-user | Export PDF of approved cases |
| `/api/{tenant}/reports/specialty.csv` | GET | JWT + tenant | None | CSV export |
| `/api/{tenant}/reports/status.csv` | GET | JWT + tenant | None | CSV export |
| `/api/{tenant}/reports/evaluations.csv` | GET | JWT + tenant + **role !== resident** | None | CSV export |
| `/api/{tenant}/reports/duty-hours.csv` | GET | JWT + tenant + scoped | None | CSV export |

### RPCs Used

| RPC Name | Called From | Parameters | Effect |
|---|---|---|---|
| `approve_case` | `/api/.../approvals/action` (server) | `p_entry_id, p_supervisor_id, p_comment` | Approves case, triggers webhook |
| `reject_case` | `/api/.../approvals/action` (server) | `p_entry_id, p_supervisor_id, p_comment` | Rejects case, triggers webhook |

### Notable Observations

1. **Two auth patterns coexist**: Reports and approvals use inline `supabase.auth.getUser()` + manual profile fetch; goals, duty-hours, and billing use `getAuthContext()`. The latter is cached and also fetches tenant + subscription + MFA info.

2. **Duplicate queries**: The reports page runs 4 count queries (`buildQuery()`) in parallel, then separately runs the distribution query (`buildEntriesQuery()`). The CSV export for `specialty.csv` re-fetches the same data the page already has — no server-side data reuse to the CSV endpoint.

3. **No optimistic UI**: All mutations (create goal, approve/reject, subscribe) use simple loading spinners or disabled buttons with no optimistic updates.

4. **Approvals has a client-side waterfall**: First fetch gets pending entries + counts, then a second query fetches `approval_requests` for those entry IDs. This is unavoidable due to the join limitation (Supabase's `in` clause).

5. **Goals has a conditional data path**: Non-directors see only their own goals; directors see all. The `GoalForm` component is only rendered for directors.

6. **Billing's error handling is unusually tolerant**: 7 independent queries, any of which can fail individually while the rest of the page renders. All other pages use early-return error displays that block the entire page.

7. **Billing has the most complex state surface**: 14 distinct state buckets across server and client components (8 inline error checks + 2 empty states + 4 conditional rendering paths).
