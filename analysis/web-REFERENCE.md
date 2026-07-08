# E-Logbook Web App — Complete Component & Admin Analysis

> **Generated**: 2026-07-08 | **Source**: Web app component agent (62 component files + 8 admin pages)

---

## apps/web/components/

### DashboardContent.tsx
**Props**: `{ data: DashboardData }` — entire dashboard payload.
**Types**: `Stats { draft, pending, approved, rejected }`, `RecentCase`, `GoalSummary`, `ResidentSummary`, `ViolationRow`, `DashboardData { profile, tenantSlug, stats, recentCases, goals, residents, pendingApprovals, totalResidents, tenantType, residentViolations?, directorViolations? }`
**Data fetches**: None — data passed as props (server-fetched).
**Internal sub-components**: `KpiRing({ value, max, label, color, delay })` — SVG ring with motion animation; `ProgressBar({ current, target, label })` — animated horizontal bar.
**States**: Empty via `EmptyState` (no recent cases/goals). Zero-case guard on rings (`max || 1`). Role-based section visibility. Framer Motion stagger animations (60–240ms delays). `useReducedMotion` respected. Frosted-glass panel `bg-surface-solid rounded-2xl border border-border`.

### CaseForm.tsx
**Props**: `{ tenantId, tenantSlug, initialStatus, duplicateCaseId?, lastEntry? }`
**Data fetches**: case_templates, template_favorites, profiles, case_entries (usage counts + tenant-wide counts), accreditation_frameworks.
**RPC calls**: `hash_patient_mrn(p_mrn, p_tenant_id)`.
**States**: Loading (templates via useEffect), Empty ("No templates available"), Error (ErrorDisplay from Supabase errors), Edge (duplicateCaseId prefill, lastEntry prefill, keyboard shortcuts Enter/Escape, PHI security note, de-identified toggle, ConfirmDialog, submitted success).
**Sub-components**: StepIndicator, TemplateStep, PatientInfoStep, CaseDetailsStep, ReviewStep, ConfirmDialog. AnimatePresence mode="wait" with slide animations.
**Validation**: `caseEntrySchema` Zod, client-side Supabase.

### ApprovalsDashboard.tsx
**Props**: `{ tenantId, tenantSlug }`
**Data fetches**: case_entries (pending + count head), approval_requests joined.
**States**: Loading, Error (with retry), Empty (checkmark icon), Edge (mountedRef guard, approval_rate calculation, today/this-week counts).
**Sub-components**: StatCard, SimpleCounter, ApprovalActions. Framer Motion itemVariants fade+slide.
**Hook**: `useApprovalsData(tenantId)` — returns entries, loading, error, fetchPending, counts, approvalRate.

### AIInsightsPanel.tsx
**Props**: `{ tenantId, residentId }`
**Data fetches**: `supabase.functions.invoke('ai-insights', { body })` — edge function.
**States**: Loading (Spinner), Error (ErrorDisplay), Edge (button text changes, scrollable response).

### SubscriptionPlans.tsx
**Props**: `{ plans, tenantId, gatewayProvider, publishableKey, currentPlanId }`
**Data fetches**: `supabase.functions.invoke('create-checkout', ...)`.
**States**: Loading (per-plan), Empty ("No plans available"), Error, Edge (current plan ring, free vs paid, stripe redirect).
**Feature groups**: CORE, PREMIUM, ENTERPRISE.

### ProgramOverviewCharts.tsx
**Props**: `{ statusCounts, specialtyCounts }`
**Sub-components**: DonutChart (SVG animated), BarChart (horizontal animated bars with tooltips).
**States**: Empty bar chart, zero guard on donut (`total || 1`). Staggered SVG animations.

### ProgressRing.tsx
**Props**: `{ percentage, label, size? (default 100) }`
**Implementation**: SVG ring, spring-animated percentage display via `useMotionValue`. Clamped 0–100.

### Skeleton Components
- **TableSkeleton** `{ rows=5, columns=4 }` — animate-pulse grid
- **CardSkeleton** — 3 animated bars
- **FormSkeleton** `{ fields=5 }` — field label + input placeholders

### ReadOnlyBanner.tsx
**Props**: `{ tenantSlug }` | Uses `useSubscriptionStatus()` context. Amber warning with days-until-suspension. `role="alert"`, "Renew now" link.

### SubscriptionStatusProvider.tsx
**Context**: `{ status, isReadOnly, isGracePeriod, daysUntilSuspension }`. Safe defaults when no provider.
**Logic**: `isReadOnly` when past_due/unpaid. 30-day grace.

### ErrorBoundary.tsx (class)
**Props**: `{ children, fallback? }`. Reports to Sentry. "Try again" button.

### ErrorDisplay.tsx
**Props**: `{ message, onRetry? }`. `role="alert"`, `toUserMessage()` transform, collapsible tech details.

### EmptyState.tsx
**Props**: `{ icon?, title, description?, action?, secondaryAction? }`. Action as link (href) or button (onClick).

### GoalForm.tsx
**Props**: `{ tenantId, directorId, residents }` | Fetches: program_goals.insert, goal_progress.insert. Validation: programGoalSchema. Modal dialog popup.

### HelpPopover.tsx
**Props**: `{ children, side? }`. Toggle on click, close on outside click/Escape. `aria-expanded`.

### MobileNav.tsx
**Props**: `{ visibleLinks, tenantSlug }`. Bottom tab bar, max 4 primary + "More" overflow. 44x44 touch targets.

### Sidebar.tsx
**Props**: `{ visibleLinks, tenantSlug, user? }`. Collapsible (localStorage), sections (Main/Review/Tools), icon map, user avatar, ThemeToggle, LocaleSwitcher, sign-out.

### Toast.tsx
**Types**: `ToastType = 'success' | 'error' | 'info'`. Portal, auto-dismiss 4s, `aria-live="polite"`. Client mount guard.

### AIConfigPanel.tsx
**Props**: `{ tenantId, config }` | Data: `fetch(/api/${tenantId}/admin/ai-config)` POST/PUT. States: Empty (default openai), Error, Success, Loading.

### PaymentGatewayPanel.tsx
**Props**: `{ tenantId, config }` | Data: `fetch(/api/${tenantId}/admin/payment-gateway)` POST/PUT. Same state pattern.

### CompetencyManager.tsx
**Props**: `{ tenantId }` | Data: accreditation_frameworks CRUD. Validation: accreditationFrameworkSchema. States: Loading, Empty, Error, Edge (expandable details, JSON parse error, delete confirmation).

### TemplateEditor.tsx
**Props**: `{ tenantId, templates }` | Data: case_templates insert/delete + impact count. States: Empty, Error, Edge (impact dialog before delete).

### UserManager.tsx
**Props**: `{ tenantId, users, currentUserRole }` | Data: signInWithOtp (invite), assign-role API. States: Empty, Error, Success.

### ClientProviders.tsx
Wraps children in ToastProvider.

### Misc: ThemeToggle, Breadcrumbs, ConsentBanner, LocaleSwitcher (en/ar/fr with RTL), InstallPrompt (PWA), SequenceIndicator, ShortcutsRenderer, CommandPalette, KeyboardShortcutsHelp, ApprovalActions, ImpactDialog, ComplianceReports, AuditExportUI, AnalyticsDashboard, DutyHoursForm, DutyHoursChart, FacultyEvaluationForm, CasePagination

---

## Admin Pages (8)

| Page | Type | Data Sources | Key Features |
|------|------|-------------|--------------|
| admin/page.tsx | Server | templates, users, ai_config, payment_gateway_config, counts | Role check, AdminTabPanel |
| admin/overview/page.tsx | Server | case_entries counts + specialties | ClientCharts, pending-by-resident table |
| admin/sso/page.tsx | Server | tenant_sso_configs (via service_role client) | SSOManager (SAML/OIDC radio cards, ACS URL, copy) |
| admin/webhooks/page.tsx | Server | tenant_webhooks + deliveries | WebhookManager (6 events, HMAC secret, test button) |
| admin/scim/page.tsx | Server | scim_tokens, constructs SCIM URL from env | SCIManager (token gen, copy, revoke) |
| admin/retention/page.tsx | Server | tenant data_retention_days | RetentionForm (RPC: set_data_retention, 365-3650 days) |
| admin/loading.tsx | — | — | 2x CardSkeleton |

---

## Supabase Queries Used (17 unique tables)
case_entries, case_templates, template_favorites, profiles, accreditation_frameworks, approval_requests, program_goals, goal_progress, duty_periods, faculty_evaluations, ai_config, payment_gateway_config, tenant_sso_configs, tenant_webhooks, tenant_webhook_deliveries, scim_tokens, tenants

## RPC Calls
`hash_patient_mrn`, `set_data_retention`

## Edge Functions Consumed
`ai-insights`, `create-checkout`

## REST API Endpoints Consumed
`/api/{tenant}/admin/ai-config`, `/admin/payment-gateway`, `/admin/sso`, `/admin/webhooks`, `/admin/webhooks/test`, `/admin/scim`, `/admin/assign-role`, `/approvals/action`, `/compliance/export`, `/audit/export`
