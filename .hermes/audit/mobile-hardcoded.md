# Mobile Hardcoded/Dead/Non-Functional Features Audit

Scope: `apps/mobile/app/**`, `apps/mobile/components/**`, `apps/mobile/lib/**` top level (Expo 56). READ-ONLY audit. Retry pass — lib/sync|security|crypto|production subdirs excluded (covered previously).

Format: | # | File | Line | Pattern | Evidence ≤3 lines | P0-P3 | Suggested fix |

**Q5 verdict (ai-insights.tsx): REAL wiring.** `supabase.functions.invoke('ai-insights', { body })` at line 120 after zod validation (`aiQuerySchema`); quota read from `ai_query_logs`; no fabricated local data. Only nit: `MAX_QUERIES = 20` hardcoded client-side (#7).

**Nav targets:** all routes in `lib/routes.ts` / `role-menu-config.ts` map to existing screen files registered in `(tabs)/_layout.tsx`. No dangling targets. Note: `case-detail` is reachable ONLY via push-notification deep link — no in-app UI navigates to it (see #1).

| # | File | Line | Pattern | Evidence ≤3 lines | P0-P3 | Suggested fix |
|---|------|------|---------|-------------------|-------|---------------|
| 1 | app/(tabs)/my-cases.tsx | 168-171 | Dead touchable (most rows) | `handleCaseTap`: only `if (c.status === 'rejected') router.push(...editCaseId)` — draft/pending/approved/conflict rows are tappable (a11yRole=button) but do nothing; case-detail unreachable in-app otherwise | P1 | Route all statuses to `/(tabs)/case-detail?caseId=` (screen exists); keep rejected→log-case if intended |
| 2 | app/(tabs)/evaluations.tsx | 611-614 | Empty onPress (comment-only stub) | `onPress={() => { /* Detail view could navigate to a full evaluation detail screen */ }}` — every EvaluationCard renders as a button that does nothing | P2 | Add evaluation-detail route or remove pressable affordance until built |
| 3 | app/(tabs)/evaluations.tsx | 620-626 | Dead touchable ("+N more") | `<TouchableOpacity className="py-2">` wrapping `+{n} more` has no onPress — renders tappable, expands nothing | P2 | Expand group list onClick, or render plain Text |
| 4 | app/(tabs)/profile.tsx | 254-260 | Alert 'Coming Soon' | `Alert.alert('Coming Soon', 'Subscription management will be available in a future update.')` behind "Manage Subscription" button | P2 | Hide button until billing flow exists, or deep-link to web billing portal |
| 5 | app/(tabs)/index.tsx | 44-46, 195 | Fake status label (never populated) | `updateLastSyncLabel` body is just `setLastSyncAgo('')`; UI renders `Last synced: {lastSyncAgo}` → always "Last synced: " | P2 | Read real timestamp from syncService.lastSyncAt, or drop the row |
| 6 | app/(tabs)/index.tsx | 200 (+ components/CaseCountWidget.tsx:18) | Hardcoded value posing as metric | `<CaseCountWidget stats={todayStats} dailyGoal={10} />` — daily goal of 10 cases is hardcoded, not per-program/per-user config | P2 | Source goal from profiles/program_goals or tenant settings table |
| 7 | app/(tabs)/ai-insights.tsx | 21 | Hardcoded config string | `const MAX_QUERIES = 20;` drives quota UI/disabled state; server limit may drift independently | P3 | Return remaining quota from the edge function response and bind UI to it |
| 8 | app/(tabs)/milestones.tsx | 15 | Hardcoded config | `const MAX_LEVEL = 5;` fixed milestone scale rendered as N progress bars | P3 | Derive max level from milestones table/metadata |
| 9 | app/(tabs)/analytics.tsx | 185-187 | Silent catch renders zeros as real data | `try { ...supabase queries... } catch { // silent }` — on failure screen shows Total: 0, 0% approved as if factual | P3 | Surface error/retry state like sibling screens do |
| 10 | app/(tabs)/evaluations.tsx | 111-118 | Duplicated hardcoded enum | `FORM_TYPES = [mini_cex, dops, cbd, msf, osce, procedure_log]` mirrors DB enum in UI code | P3 | Import form_type enum/check constraint from @elogbook/shared or DB catalog |
| 11 | app/(tabs)/duty-hours.tsx | 11-17 | Duplicated hardcoded enum | `SHIFT_TYPES = [call, clinic, vacation, weekend, regular]` hardcoded chip list | P3 | Move to shared package alongside other domain enums |

## Not found (checked, clean)
- No `onPress={() => {}}` literals, no console.log-only handlers in scope.
- No TODO/FIXME markers outside the single "Coming Soon" alert (#4).
- No mock/hardcoded data arrays rendered as DB results — every screen queries Supabase (case_entries, program_goals, approval_requests, rotations, milestones, evaluations).
- All router.push/replace targets and SideMenu routes resolve to existing files.
- Env config properly via EXPO_PUBLIC_* in lib/supabase.ts (no baked URLs/keys).

## Counts
P0: 0 · P1: 1 · P2: 5 · P3: 5 · Total: 11
