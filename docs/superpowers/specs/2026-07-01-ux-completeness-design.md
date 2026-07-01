# UX Completeness — Design Spec

**Date**: 2026-07-01
**Project**: E-Logbook Enterprise
**Status**: Approved design

---

## 1. Onboarding Wizard

Route: `/onboarding` — new page, server-rendered check for `profiles.onboarding_completed`, redirects to `/onboarding` if `false` or `null`.

### Steps

| Step | Fields | API |
|------|--------|-----|
| 1 — Role | Role selector (resident / supervisor / director) | Updates `profiles.role` via Supabase |
| 2 — Profile | Full name, specialty (dropdown from predefined list), phone | Updates `profiles.full_name`, `profiles.specialty` |
| 3 — Team (optional) | Email input + "Add another" counter; submit invites | Calls existing invite flow |
| 4 — Done | Role-specific summary + "Go to Dashboard" button | Sets `profiles.onboarding_completed = true` |

### Table Changes
- `profiles` table: add `onboarding_completed boolean default false` column (migration 00064)
- Update `handle_new_user()` trigger to set `onboarding_completed = false`

### Guard
- Authenticated layout checks `onboarding_completed` — if `false` and not already on `/onboarding`, redirect to `/onboarding`
- If already on `/onboarding` and `onboarding_completed = true`, redirect to dashboard

---

## 2. Empty States

All pages use the existing `EmptyState` component (`components/EmptyState.tsx`). Each page checks its data source and renders `<EmptyState>` when the data array is empty.

| Page | Icon | Title | Description | Action |
|------|------|-------|-------------|--------|
| `/cases` | clipboard | "No cases logged yet" | "Your case entries will appear here once you log your first procedure." | "Log your first case" → `/cases/new` |
| `/approvals` | check-circle | "No pending approvals" | "All caught up! You have no pending verification requests." | — |
| `/goals` (director) | target | "No goals set" | "Set program goals to track resident progress." | "Create a goal" → uses existing GoalForm |
| `/goals` (resident) | target | "No goals yet" | "Your program goals will appear here once your director sets them." | — |
| `/audit` | activity | "No audit entries" | "The audit log is empty for this period." | — |
| `/billing` | credit-card | "No payments yet" | "Your payment history will appear here once you subscribe." | "View plans" → `/billing` |
| `/reports` | file-text | "No reports generated" | "Generate your first performance report to see data here." | "Generate report" → triggers report generation |
| `/admin/overview` | eye | "No data yet" | "Invite your team to start logging cases." | "Invite team" → invite UI |

### Data Fetching Pattern
- Server component fetches data
- If `data.length === 0`, render `<EmptyState>` instead of the list
- Otherwise render the existing list/table

---

## 3. Loading Skeletons

Wrap each data-fetching section in `<Suspense>` with existing skeleton components.

### Pages and Skeleton Layouts

| Page | Sections | Skeleton | Suspense Key |
|------|----------|----------|-------------|
| Dashboard | KPI row (4 cards) | `CardSkeleton` × 4 | `kpi-row` |
| Dashboard | Recent cases | `TableSkeleton` | `recent-cases` |
| Cases | Case list | `TableSkeleton` | `case-list` |
| Approvals | Approval cards | `CardSkeleton` × 3 | `approval-cards` |
| Goals | Goal cards | `CardSkeleton` × goal count | `goal-list` |
| Reports | Report cards | `CardSkeleton` × 2 | `report-cards` |
| Admin/overview | Stats | `CardSkeleton` × 3 | `admin-stats` |
| Admin/overview | Charts | `FormSkeleton` | `admin-charts` |

### Implementation
- Existing `components/CardSkeleton.tsx`, `components/TableSkeleton.tsx`, `components/FormSkeleton.tsx` are used directly
- No new skeleton components needed
- `<Suspense fallback={<TableSkeleton />}>` wrapping in server component pages

---

## 4. Error Boundaries + Retry

- Pages already have a root `ErrorBoundary` in `layout.tsx`
- Add section-level `<ErrorBoundary>` wrapping each independent data section
- Use existing `components/ErrorBoundary.tsx` and `components/ErrorDisplay.tsx`

### Sections
| Page | Boundary Wraps | Granularity |
|------|---------------|-------------|
| Dashboard | KPI row, recent cases, goals progress | 3 boundaries |
| Cases | Case list | 1 boundary |
| Approvals | Approval list | 1 boundary |
| Goals | Goal cards | 1 boundary |
| Reports | Report list | 1 boundary |
| Audit | Audit table | 1 boundary |
| Admin/overview | Stats, charts, config panels | 3 boundaries |

---

## 5. Role-Based Navigation

`components/Sidebar.tsx` receives `role` prop from the authenticated layout. Filter nav links:

| Link | resident | supervisor | director | institution_admin | admin |
|------|----------|------------|----------|-------------------|-------|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cases | ✅ | ✅ | ✅ | ✅ | — |
| Approvals | — | ✅ | ✅ | — | — |
| Goals | ✅ | — | ✅ | — | — |
| Reports | ✅ | ✅ | ✅ | ✅ | — |
| Billing | — | — | — | ✅ | ✅ |
| Admin | — | — | ✅ | ✅ | ✅ |
| Audit | — | — | ✅ | ✅ | ✅ |

Current sidebar renders all links unconditionally. Refactor navigation items into a filterable array with `roles` property.

---

## 6. Toast Notifications

Existing `components/Toast.tsx` provides a notification system. Wire it to all mutations.

### Events
| Mutation | Toast Type | Message |
|----------|-----------|---------|
| Case saved (draft) | `success` | "Case saved as draft" |
| Case submitted | `success` | "Case submitted for approval" |
| Case approved | `success` | "Case approved" |
| Case rejected | `warning` | "Case rejected: {reason}" |
| Goal created | `success` | "Goal created" |
| Goal updated | `success` | "Goal updated" |
| Settings saved | `success` | "Settings saved" |
| Invite sent | `success` | "Invite sent to {email}" |
| Payment processed | `success` | "Payment successful" |
| Error | `error` | "{error message}" |

### Implementation
- Wrap app in `ToastProvider` context (if not already)
- Create `useToast()` hook returning `toast.success(msg)`, `toast.error(msg)`, `toast.warning(msg)`
- Call from mutation handlers after successful/failed operations

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `apps/web/app/onboarding/page.tsx` | New — wizard component |
| `apps/web/app/(authenticated)/layout.tsx` | Add onboarding guard |
| `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx` | Add Suspense + ErrorBoundary |
| `apps/web/app/(authenticated)/[tenant]/cases/page.tsx` | Add empty state + Suspense |
| `apps/web/app/(authenticated)/[tenant]/approvals/page.tsx` | Add empty state + Suspense |
| `apps/web/app/(authenticated)/[tenant]/goals/page.tsx` | Add empty state + Suspense |
| `apps/web/app/(authenticated)/[tenant]/reports/page.tsx` | Add empty state + Suspense |
| `apps/web/app/(authenticated)/[tenant]/audit/page.tsx` | Add empty state + Suspense |
| `apps/web/app/(authenticated)/[tenant]/billing/page.tsx` | Add empty state |
| `apps/web/app/(authenticated)/[tenant]/admin/overview/page.tsx` | Add empty state + Suspense |
| `apps/web/components/Sidebar.tsx` | Role-based nav filtering |
| `apps/web/components/Toast.tsx` | Ensure ToastProvider + useToast hook exist |
| `apps/web/components/DashboardContent.tsx` | Add toast calls on mutation |
| `apps/web/components/CaseForm.tsx` | Add toast calls |
| `apps/web/components/GoalForm.tsx` | Add toast calls |
| `apps/web/components/ApprovalsDashboard.tsx` | Add toast calls |
| `supabase/migrations/00064_onboarding_flag.sql` | Add `onboarding_completed` column |
