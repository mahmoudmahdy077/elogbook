# Tasks: Premium Mobile Logbook

**Input**: Design documents from `/specs/001-premium-mobile-logbook/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not requested — implementation tasks only. Validation via `quickstart.md` scenarios.

**Organization**: Tasks grouped by user story for independent implementation. Each story is independently testable via the quickstart validation scenarios.

**AI/Vibe-Coding Notes**:
- Every task includes exact file paths — no file discovery needed
- Each task specifies exactly what to do, what file to touch, and what imports/dependencies are needed
- Tasks are atomic: one clear action per task, no multi-step ambiguity
- Before/after code hints provided for complex modifications
- Validation checkpoints after each phase to catch errors early

## Format: `- [ ] [ID] [P?] [Story] Description with exact file path`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks in same phase)
- **[Story]**: Maps to user story (US1, US2, US3, US4, US5, US6)
- Every task includes the exact file path to create or modify
- No task should require the AI to guess which file to edit

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database migration, shared types, design tokens — foundational work that all user stories depend on

- [x] T001 Create database migration file at `supabase/migrations/00008_premium_mobile_logbook.sql` that adds: (1) `region TEXT NOT NULL DEFAULT 'us-east-1'`, `data_retention_days INTEGER DEFAULT 2555`, `consent_required BOOLEAN DEFAULT true`, `compliance_frameworks TEXT[] DEFAULT '{}'` to `tenants` table; (2) `disclaimer_rendered BOOLEAN DEFAULT false`, `response_format TEXT DEFAULT 'text' CHECK (response_format IN ('text', 'stream'))`, `safety_flags TEXT[] DEFAULT '{}'` to `ai_query_logs` table. Use ALTER TABLE ... ADD COLUMN IF NOT EXISTS for idempotency.

- [x] T002 [P] Add `ComplianceConfiguration` TypeScript interface to `packages/shared/src/types/database.ts`: `export interface ComplianceConfiguration { region: string; data_retention_days: number; consent_required: boolean; compliance_frameworks: string[]; }`. Add `compliance: ComplianceConfiguration` as optional field to the existing `Tenant` interface.

- [x] T003 [P] Add `region`, `data_retention_days`, `consent_required`, `compliance_frameworks` fields to the existing `Tenant` TypeScript interface in `packages/shared/src/types/database.ts`. Types: `region: string`, `data_retention_days: number`, `consent_required: boolean`, `compliance_frameworks: string[]`.

- [x] T004 [P] Add `disclaimer_rendered`: boolean`, `response_format: 'text' | 'stream'`, `safety_flags: string[]` fields to the existing `AIConfig` or `AIQueryLog` TypeScript interface in `packages/shared/src/types/database.ts` (match the `ai_query_logs` table columns).

- [x] T005 [P] Create shared Tailwind design token preset at `packages/shared/src/constants/design-tokens.ts` exporting: `clinicalColors` object with keys `backdrop: '#060814'`, `panel: '#0F172A'`, `primary: '#0D9488'`, `secondary: '#6366F1'`, `amber: '#D97706'`, `emerald: '#059669'`, `crimson: '#DC2626'`, `neutralLight: '#E2E8F0'`; `clinicalFonts` object with keys `heading: 'Outfit'`, `body: 'Inter'`, `mono: 'Geist Mono'`; `animationTokens` object with keys `defaultTransition: '200ms cubic-bezier(0.4, 0, 0.2, 1)'`, `springSlideUp: { tension: 170, friction: 26 }`, `staggerDelay: 50`.

- [x] T006 [P] Create shared animation constants at `packages/shared/src/constants/animations.ts` exporting: `DEFAULT_TRANSITION = { duration: 0.2, ease: [0.4, 0, 0.2, 1] }` as a Framer Motion-compatible object, `SPRING_SLIDE_UP = { type: 'spring' as const, stiffness: 170, damping: 26 }`, `STAGGER_DELAY = 0.05`, `CARD_EXIT_ANIMATION = { x: -300, opacity: 0, transition: { duration: 0.3 } }`, `KPI_COUNT_UP = { duration: 1.5, ease: 'easeOut' }`.

- [x] T007 [P] Add `complianceConfigSchema` Zod schema to `packages/shared/src/schemas/auth.ts`: `export const complianceConfigSchema = z.object({ region: z.enum(['us-east-1', 'eu-west-1', 'me-central-1', 'ap-southeast-1']), data_retention_days: z.number().int().min(365).max(3650), consent_required: z.boolean(), compliance_frameworks: z.array(z.enum(['hipaa', 'gdpr', 'scfhs', 'gmc', 'pipeda', 'australian_privacy'])) });`.

- [x] T008 [P] Add `aiQuerySchema` Zod schema to `packages/shared/src/schemas/cases.ts`: `export const aiQuerySchema = z.object({ query: z.string().min(1).max(500), resident_id: z.string().uuid(), tenant_id: z.string().uuid(), stream: z.boolean().default(false) });`.

- [x] T009 [P] Update the barrel export at `packages/shared/src/index.ts` to export all new symbols: `complianceConfigSchema` from `./schemas/auth`, `aiQuerySchema` from `./schemas/cases`, `ComplianceConfiguration` from `./types/database`, and exports from `./constants/design-tokens` and `./constants/animations`.

- [x] T010 TypeScript verify: run `pnpm --filter @elogbook/shared typecheck` and fix any type errors from the new schemas and types. The build must pass with zero errors before proceeding.

**Checkpoint**: Shared package builds clean. Database migration ready to apply. Design tokens available for all user stories.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story implementation begins

- [x] T011 Apply database migration: run `supabase db reset` to apply `00008_premium_mobile_logbook.sql`. Verify with `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tenants' AND column_name IN ('region', 'data_retention_days', 'consent_required', 'compliance_frameworks');` — all 4 columns must exist.

- [x] T012 [P] Install new mobile dependencies: Edit `apps/mobile/package.json` and add `@react-native-community/netinfo`, `react-native-sse`, `react-native-svg`, `@react-native-community/blur` to dependencies. Include version ranges: `"@react-native-community/netinfo": "^11.4.0"`, `"react-native-sse": "^1.2.0"`, `"react-native-svg": "^15.8.0"`, `"@react-native-community/blur": "^4.1.0"`. Run `pnpm install` from repo root.

- [x] T013 [P] Update mobile Tailwind config at `apps/mobile/tailwind.config.js` to import design tokens from `@elogbook/shared`: add `const { clinicalColors } = require('@elogbook/shared');` and extend the theme.colors with all clinicalColors keys. Keep existing NativeWind preset.

- [x] T014 [P] Update web globals.css at `apps/web/app/globals.css` to add glass-panel motion tokens: add CSS custom properties `--motion-default: 200ms cubic-bezier(0.4, 0, 0.2, 1);`, `--glass-blur: 12px;`, `--glass-border: rgba(255, 255, 255, 0.05);`, `--glass-shadow: 0 8px 32px rgba(6, 8, 20, 0.4);`. Import these into the existing `.glass-panel` class. Add a new `.glass-panel-sheet` class variant that adds `border-radius: 16px 16px 0 0` for bottom sheets.

- [x] T015 [P] Create mobile GlassPanel component at `apps/mobile/components/GlassPanel.tsx`: a reusable React Native wrapper that (a) accepts `blurIntensity` (default 12), `children`, optional `style` props; (b) uses `BlurView` from `@react-native-community/blur` as background with `blurType="dark"` and `blurAmount={blurIntensity}`; (c) overlays a View with `className="border border-white/5 rounded-2xl"` and background `rgba(15, 23, 42, 0.7)` (the panel color from design tokens at 70% opacity); (d) exports as default. No children modification — pure wrapper.

- [x] T016 [P] Create mobile ProgressRing component at `apps/mobile/components/ProgressRing.tsx`: accepts props `percentage: number` (0-100), `specialty: string`, `color: string`, `glowColor: string`, `size?: number` (default 120). Renders using `react-native-svg`: (a) background `<Circle>` with `stroke="#1E293B"` (slate-800), `strokeWidth={8}`, `fill="none"`; (b) progress `<Circle>` with `stroke={color}`, `strokeWidth={8}`, `strokeLinecap="round"`, `strokeDasharray={circumference}`, `strokeDashoffset={circumference * (1 - percentage/100)}` where `circumference = 2 * Math.PI * radius`; (c) SVG `<defs>` with `<filter id="glow">` containing `<feGaussianBlur stdDeviation="3">` for glow effect; (d) centered `<SvgText>` showing `${Math.round(percentage)}%` in white/Outfit; (e) specialty label below the percentage. Use Reanimated `useAnimatedProps` to animate `strokeDashoffset` from `circumference` to target value on mount.

- [x] T017 [P] Create mobile Haptics hook at `apps/mobile/lib/haptics.ts`: export `useHaptics()` that returns object with methods: `submitSuccess() → Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)`, `submitError() → Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)`, `offlineSave() → Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)`, `approvalAction() → Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)`, `selection() → Haptics.selectionAsync()`. Import `* as Haptics from 'expo-haptics'`. Must be a named export (not default).

- [x] T018 TypeScript & lint verify: run `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck && pnpm --filter @elogbook/shared typecheck` then `pnpm --filter @elogbook/web lint && pnpm --filter @elogbook/mobile lint`. All must pass with zero errors before proceeding to user stories.

**Checkpoint**: Foundation ready — database migrated, design tokens shared, mobile components created, all typechecks pass. User story implementation can now begin.

---

## Phase 3: User Story 1 — One-Handed Shift Case Logging (Priority: P1) 🎯 MVP

**Goal**: Residents log surgical/clinical cases rapidly with one hand on mobile, with premium HeroUI template cards, auto-advancing wizard, haptic feedback, and offline support.

**Independent Test**: Resident logs in, selects a specialty template, fills required fields one-handed, submits — case appears in my-cases list with glowing amber "Pending" badge, and a verification request is created visible to supervisors. Offline submission saves locally and auto-syncs on connectivity restore.

### Implementation for User Story 1

- [x] T019 [P] [US1] Redesign mobile template selection screen in `apps/mobile/app/(tabs)/log-case.tsx` Phase 1 (template list): Replace the current flat template list with a visually striking grid of premium cards. Each card must show: (a) a medical icon for the specialty (import Ionicons from `@expo/vector-icons`, map specialty→icon: surgery→'cut', radiology→'radio', emergency→'flash', internal→'heart', custom→'flask'); (b) specialty name in Outfit font; (c) required field count as a small badge; (d) `className="bg-slate-900 border border-indigo-500/15 rounded-xl p-4 active:scale-95"` with `NativeWind`; (e) selection state with glowing teal border (`border-teal-400 border-2`). Templates load from existing Supabase query (keep existing fetch logic, replace only the render). The `FlatList` must use `numColumns={2}` for grid layout. Max 200 lines.

- [x] T020 [P] [US1] Redesign web case form wizard in `apps/web/components/CaseForm.tsx`: Add step indicator UI showing Template → Patient Info → Case Details → Review with checkmark icons on completed steps. Use HeroUI `<Progress>` or custom step indicators with the clinical teal color. Steps that are not yet reachable show muted styling; current step has teal glow border; completed steps show teal checkmark. The step indicator must sit at the top of the form and remain visible during scroll. Do NOT change existing form field logic — only add the visual step indicator.

- [x] T021 [US1] Add one-thumb optimization to mobile case form in `apps/mobile/app/(tabs)/log-case.tsx` Phase 2 (form): After template selection, the form must: (a) render all fields in a `ScrollView` with `contentContainerStyle={{ paddingBottom: 100 }}` to ensure the Submit button is always reachable; (b) place the Submit button in a fixed position at the bottom of the screen (`position: 'absolute', bottom: 0` with safe area padding); (c) all input fields must use `returnKeyType="next"` and `blurOnSubmit={false}` to auto-advance to next field on keyboard "next" press; (d) date fields must use a tappable date display that opens a platform date picker (use `DateTimePicker` from `@react-native-community/datetimepicker` or Expo's date picker) — no manual typing of dates.

- [x] T022 [US1] Add haptic feedback to mobile case submission in `apps/mobile/app/(tabs)/log-case.tsx` Phase 3 (submit): Import `useHaptics` from `@/lib/haptics`. On successful Supabase insert: call `haptics.submitSuccess()`. On insert failure (triggers offline save): call `haptics.offlineSave()`. On validation error: call `haptics.submitError()`. Wrap submit handler to call haptics BEFORE navigation/state change.

- [x] T023 [US1] Add celebratory confirmation animation to mobile case submission in `apps/mobile/app/(tabs)/log-case.tsx` Phase 4 (animation): After successful submission and haptic, show an animated confirmation overlay for 2 seconds: a centered View with (a) a teal checkmark icon (`Ionicons name="checkmark-circle"`) that scales up from 0 to 1 with spring animation via Reanimated; (b) text "Case Logged Successfully" fading in; (c) text "Pending Verification" in amber; (d) after 2 seconds, navigate to my-cases tab. Use `Animated.View` from `react-native-reanimated` — import `{ useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay }`.

- [x] T024 [US1] Add offline indicator to mobile log-case screen in `apps/mobile/app/(tabs)/log-case.tsx` Phase 5 (offline UI): Import `SyncService` from `@/lib/sync` (it provides `onStatusChange`). Subscribe to status changes. When `status === 'offline'`: show a yellow banner at top of screen with text "Offline Mode — cases saved locally" and a small cloud-offline icon. When `status === 'syncing'`: show a blue pulsing dot with text "Syncing...". When `status === 'synced'`: flash a green "Synced" badge for 2 seconds then hide. When `status === 'error'`: show red banner "Sync failed — will retry". Implement as a `SyncStatusBanner` sub-component within the same file (no separate file needed) to keep within file size limit.

- [x] T025 [US1] Add template loading and empty states to mobile log-case in `apps/mobile/app/(tabs)/log-case.tsx` Phase 6 (edge cases): (a) Loading state: while templates are fetching from Supabase, show a `FlatList` of 4 skeleton placeholder cards (gray rectangles with shimmer animation via Reanimated `FadeIn`/`FadeOut`); (b) Empty state: when templates array is empty, show centered text "No templates available. Contact your program director." with a medical clipboard icon; (c) Error state: when Supabase query fails, show centered text "Unable to load templates" with a "Retry" button that re-triggers the fetch.

- [x] T026 [US1] Enhance web case form de-identification step in `apps/web/components/CaseForm.tsx`: Improve the existing de-identification toggle UX: (a) add a `HelpPopover` (import existing component) next to the toggle explaining HIPAA de-identification in plain clinical language ("De-identification removes patient identifiers — recommended for logbook entries"); (b) when toggled ON, show a green "Safe Harbor Compliant" badge; (c) when toggled OFF, show an amber warning "Contains Patient Identifiers" badge with tooltip; (d) ensure the `caseEntrySchema` discriminated union validation still correctly validates based on `is_deidentified` value — do NOT change validation logic, only enhance visual presentation.

- [x] T027 [US1] Add rapid successive submission handling to mobile log-case in `apps/mobile/app/(tabs)/log-case.tsx` Phase 7 (edge case): Add a `isSubmitting` ref/state that prevents double-tap. When Submit is pressed: (a) immediately set `isSubmitting = true` and disable the submit button with `opacity-50`; (b) on success or error, re-enable after 1 second debounce; (c) clear form fields after successful submission so resident can immediately log another case; (d) keep the selected template pre-selected for rapid repeat logging of same specialty (add a "Change Template" link to switch).

### Verification for User Story 1

- Run `pnpm --filter @elogbook/mobile typecheck` — must pass
- Run `pnpm --filter @elogbook/web typecheck` — must pass
- Manual test: Log in as `resident@demo.com` / `password123!`, navigate to Log Case, verify template cards render with icons, verify one-thumb reach, verify haptic on submit, verify offline banner in Airplane mode
- Refer to `quickstart.md` VS-1 and VS-7 for full validation steps

**Checkpoint**: Resident case logging fully functional with premium design, haptics, offline support, and edge case handling. Independently testable.

---

## Phase 4: User Story 2 — Beautiful Verification Dashboard (Priority: P1)

**Goal**: Supervisors review, approve, or reject cases through a premium dashboard with animated KPIs, glass-panel case detail sheets, celebration animations, and urgency indicators.

**Independent Test**: Supervisor logs in, sees pending cases grouped by resident with profile avatars, taps a case to see glass-panel detail sheet, approves with emerald glow button — card exits with animation, resident's progress updates.

### Implementation for User Story 2

- [x] T028 [P] [US2] Rewrite mobile approvals screen from placeholder to full verification dashboard at `apps/mobile/app/(tabs)/approvals.tsx`: Replace the entire file content. New implementation: (a) fetch pending `case_entries` from Supabase joined with `profiles` (resident name, avatar initial) and `case_templates` (specialty, template name) — use existing Supabase client from `@/lib/supabase`; (b) group cases by `resident_id` with a section header showing resident full name, specialty, and a small circular avatar (first letter of name); (c) render each case as a premium card with: specialty badge (colored chip), template name, case date (relative: "2h ago"), de-identified patient summary ("Age: 34, Surgery"), status badge; (d) add urgency indicators: if case is older than 48 hours, show a subtle amber clock icon with "Needs Review" text; (e) tapping a case opens the glass-panel detail sheet. Max 250 lines.

- [x] T029 [US2] Add glass-panel case detail sheet to mobile approvals at `apps/mobile/app/(tabs)/approvals.tsx` (in same file — extend previous task): When a case card is tapped: (a) render a `<Modal>` (from `react-native`) with `animationType="slide"` and `transparent={true}`; (b) wrap content in the `<GlassPanel>` component from `@/components/GlassPanel` (created in T015) with `blurIntensity={12}`; (c) display all case fields from `field_values` JSONB rendered as labeled rows; (d) show resident's reflection notes if present; (e) show procedure details from template fields; (f) at the bottom, show two buttons side by side: "Approve" with emerald background (`bg-emerald-600`) and checkmark icon, "Reject" with crimson background (`bg-red-600`) and close icon; (g) add an optional comment `TextInput` for rejection feedback that appears with animation when "Reject" is tapped (conditional render).

- [x] T030 [US2] Add approve/reject logic to mobile approvals at `apps/mobile/app/(tabs)/approvals.tsx` (extend previous task): Wire approve button to call `supabase.rpc('approve_case', { p_entry_id: entry_id, p_supervisor_id: supervisor_id, p_comment: comment })` and reject button to call `supabase.rpc('reject_case', { p_entry_id: entry_id, p_supervisor_id: supervisor_id, p_comment: comment })`. Parse the returned JSONB: on success, update local state; on `already_reviewed` error, show Alert "Case already reviewed"; on other errors, show Alert with the returned error message. After successful action: (a) trigger `haptics.approvalAction()`; (b) animate the case card exiting the list (slide left with opacity to 0 over 300ms); (c) remove from local state; (d) update the KPI counters. Note: the RPC functions are created in T065; if T065 is not yet complete, stub the calls and revisit once the migration is applied.

- [x] T031 [P] [US2] Add animated KPI counters to web verification dashboard at `apps/web/components/ApprovalsDashboard.tsx`: At the top of the dashboard, add 4 KPI cards in a horizontal row: (a) "Pending" count with amber accent; (b) "Today" count (approved today) with teal accent; (c) "This Week" count; (d) "Approval Rate" percentage. Each KPI card must use Framer Motion `useSpring` or `useMotionValue` to animate the number counting up from 0 on mount. Import `{ motion, useMotionValue, useTransform, animate } from 'framer-motion'`. The counter animation must use `animate(value, targetNumber, { duration: 1.5, ease: 'easeOut' })` and display with `useTransform(value, v => Math.round(v))`.

- [x] T032 [US2] Add celebration animation to web approval actions at `apps/web/components/ApprovalActions.tsx`: When Approve is clicked: (a) after successful Supabase update, show a brief celebration overlay: a centered teal checkmark icon that scales up with spring animation and fades after 1.5 seconds; (b) the approved case card exits with `animate={{ x: -300, opacity: 0 }}` using Framer Motion `AnimatePresence`; (c) trigger a success Toast via existing `useToast()` hook with message "Case approved — resident notified". When Reject is clicked: similar animation but with crimson X icon and "Case rejected with feedback" toast. The `AnimatePresence` wrapper must be added to the parent component (ApprovalsDashboard.tsx) around the case list mapping.

- [x] T033 [US2] Add urgency indicators to web verification dashboard at `apps/web/components/ApprovalsDashboard.tsx`: For each pending case card: (a) if `created_at` is older than 48 hours from now, add an amber urgency badge showing the time elapsed ("3d ago") with a clock icon; (b) if older than 7 days, use crimson urgency badge with "Overdue" label; (c) sort the case list so urgent items appear first (oldest first). Use `date-fns` `differenceInHours` and `formatDistanceToNow` for time calculations — already a dependency.

- [x] T034 [US2] Add empty state to web verification dashboard at `apps/web/components/ApprovalsDashboard.tsx`: When no pending cases exist (array length 0), render the existing `<EmptyState>` component (import from `@/components/EmptyState`) with: icon = a clipboard checkmark, title = "All Caught Up", description = "No pending cases to review. Great work!", no primary action button, secondary action = link to "View All Cases".

**Verification for User Story 2**

- Run `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` — must pass
- Manual test: Login as `supervisor@demo.com`, verify KPI counters animate, verify case cards group by resident, verify glass-panel detail sheet slides up, verify approve/reject with celebration animation
- Refer to `quickstart.md` VS-2 for full validation steps

**Checkpoint**: Supervisor verification fully functional on both platforms with premium design. Independently testable.

---

## Phase 5: User Story 3 — Resident Progress & Accreditation Tracking (Priority: P2)

**Goal**: Residents see animated SVG progress rings per specialty, deadline nudges, and chronological verified case timelines — driving engagement and accreditation compliance.

**Independent Test**: Resident navigates to progress/dashboard, sees animated progress rings per specialty with glowing arcs and percentages, taps a ring to see verified case timeline.

### Implementation for User Story 3

- [x] T035 [P] [US3] Integrate ProgressRing component into mobile dashboard at `apps/mobile/app/(tabs)/index.tsx`: Replace current stat cards with the `<ProgressRing>` component (import from `@/components/ProgressRing`). Fetch `program_goals` with `goal_progress` from Supabase for the current resident. For each goal: render a `<ProgressRing>` with `percentage={goalProgress.current_count / goal.target_count * 100}`, `specialty={goal.specialty}`, `color="#0D9488"` (teal), `glowColor="#0D9488"`. Arrange rings in a `ScrollView horizontal` or `FlatList` with horizontal scroll. Below rings, show a summary card: "X of Y goals on track". Keep existing "Log New Case" button.

- [x] T036 [US3] Add progress ring tap-to-expand timeline in mobile dashboard at `apps/mobile/app/(tabs)/index.tsx` (extend previous): When a ProgressRing is tapped: (a) navigate to or expand an inline detail view showing a chronological `FlatList` of verified cases for that specialty; (b) each timeline entry shows: case date (formatted as "Jan 15, 2026"), template name, status badge (glowing emerald for approved), approving supervisor's name; (c) entries ordered newest first; (d) "X verified / Y target" header; (e) back button to return to rings view.

- [x] T037 [P] [US3] Add animated progress rings to web dashboard at `apps/web/components/DashboardContent.tsx`: Replace existing goal progress section with SVG circular progress rings matching the mobile design. Use inline SVG (no new dependencies): (a) `<svg viewBox="0 0 120 120">` with `<circle>` for track (stroke `#1E293B`) and progress (stroke `#0D9488` with glow filter); (b) Framer Motion `useSpring` to animate the `strokeDashoffset` from full circumference to target; (c) centered text showing percentage; (d) specialty label below; (e) wrap in a CSS grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4`. The existing `goal_progress` data fetch from `app/(authenticated)/[tenant]/dashboard/page.tsx` already provides the data — only modify the presentation in DashboardContent.

- [x] T038 [US3] Add deadline nudge to web dashboard at `apps/web/components/DashboardContent.tsx`: For each goal where `deadline` is within 30 days and `current_count < target_count`: (a) show a supportive amber banner below the progress ring: "X cases needed by [date]" with a gentle pulsing animation; (b) if deadline is within 7 days, use a more prominent amber banner with clock icon; (c) if past deadline and not met, show encouraging "Keep going! Target extended" message — never show failure or negative messaging per clinical supportive voice tone. Use `date-fns` `differenceInDays` for calculations.

- [x] T039 [US3] Add web goals page progress ring integration at `apps/web/app/(authenticated)/[tenant]/goals/page.tsx`: Replace the existing HeroUI `<ProgressBar>` components with the same SVG progress ring design created in T037. Extract the ring rendering into a shared component file `apps/web/components/ProgressRing.tsx` (accept props: `percentage`, `label`, `color`, `glowColor`, `size`) to avoid duplication between dashboard and goals page. Use this component in both `DashboardContent.tsx` and the goals page.

**Verification for User Story 3**

- Run `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` — must pass
- Manual test: Login as resident, verify progress rings animate on viewport entry, tap ring for timeline, verify deadline nudges
- Refer to `quickstart.md` VS-3 for full validation steps

---

## Phase 6: User Story 4 — Cross-Platform Design Consistency (Priority: P2)

**Goal**: Mobile and web applications share identical visual identity — colors, typography, glass-panels, status badges, motion patterns — powered by the shared clinical design token system.

**Independent Test**: Open same screen side-by-side on mobile and web. Colors match, fonts match, badges glow identically, glass-panels have identical blur/border/shadow, interactive states are consistent.

### Implementation for User Story 4

- [x] T040 [P] [US4] Apply shared design tokens to mobile global.css at `apps/mobile/global.css`: Replace hardcoded Tailwind color values with design tokens from `@elogbook/shared`. Import `clinicalColors` and add them to the Tailwind theme via `tailwind.config.js` (already configured in T013). Verify that `bg-backdrop` resolves to `#060814`, `text-primary` to `#0D9488`, `text-secondary` to `#6366F1`. Add custom utility classes: `.glass-panel-mobile { background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 16px; }` for fallback when GlassPanel component is overkill. Ensure `NativeWind` processes these classes.

- [x] T041 [P] [US4] Apply shared design tokens to web globals.css at `apps/web/app/globals.css`: Verify existing CSS custom properties match the shared design tokens from `@elogbook/shared`. Update any hardcoded color values to reference the shared token values. Specifically: (a) `--color-backdrop` must match `clinicalColors.backdrop`; (b) `--color-primary` must match `clinicalColors.primary`; (c) `--color-secondary` must match `clinicalColors.secondary`; (d) badge glow classes `.badge-pending`, `.badge-approved`, `.badge-rejected` must use exact hex values from `clinicalColors.amber/emerald/crimson` with matching glow `box-shadow` using those colors at 40% opacity.

- [x] T042 [P] [US4] Standardize status badge rendering across all mobile screens: Create a shared mobile badge component at `apps/mobile/components/StatusBadge.tsx` that accepts props `status: 'draft' | 'pending' | 'approved' | 'rejected'`. Renders a `<View>` with: (a) `draft` → `className="border border-slate-500 rounded-full px-3 py-1"`, text "Draft" in slate-400; (b) `pending` → `className="bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1"`, text "Pending" in amber-400 with glow `shadow-amber-500/20`; (c) `approved` → `className="bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1"`, text "Approved" in emerald-400 with glow `shadow-emerald-500/20`; (d) `rejected` → `className="bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1"`, text "Rejected" in red-400 with glow `shadow-red-500/20`. Replace all inline badge rendering in `my-cases.tsx`, `approvals.tsx`, and `log-case.tsx` with this component.

- [x] T043 [P] [US4] Standardize status badge rendering across all web components: Verify the existing badge CSS classes in `globals.css` (`.badge-draft`, `.badge-pending`, `.badge-approved`, `.badge-rejected`) match the mobile `<StatusBadge>` component styling from T042 exactly. Update if any differences found. The visual outcome must be pixel-perfect identical: same colors, same glow intensity, same border radius, same padding, same font size. Use browser devtools side-by-side with Expo Go screenshot to verify.

- [x] T044 [US4] Apply consistent motion tokens across all web animations: Update all Framer Motion `transition` objects to use the shared `DEFAULT_TRANSITION` constant from `@elogbook/shared`. Files to update: (a) `apps/web/components/DashboardContent.tsx` — staggered entrance animations; (b) `apps/web/components/ApprovalsDashboard.tsx` — KPI counters; (c) `apps/web/components/CaseForm.tsx` — wizard step transitions; (d) `apps/web/components/Toast.tsx` — toast enter/exit. Import: `import { DEFAULT_TRANSITION, STAGGER_DELAY } from '@elogbook/shared';`. Replace inline `transition={{ duration: 0.2 }}` with `transition={DEFAULT_TRANSITION}`. Replace hardcoded stagger delays with `STAGGER_DELAY`.

- [x] T045 [US4] Apply consistent motion tokens across all mobile animations: Update all Reanimated animation configs to use shared animation constants. Files to update: (a) `apps/mobile/app/(tabs)/log-case.tsx` — confirmation animation (use `withSpring` with shared spring config); (b) `apps/mobile/app/(tabs)/approvals.tsx` — card exit animation (use `withTiming` with shared duration); (c) `apps/mobile/components/ProgressRing.tsx` — ring animation (use `withTiming` with shared duration). Convert animation values: `DEFAULT_TRANSITION.duration = 0.2` → Reanimated `withTiming(value, { duration: 200 })`. The easing function `[0.4, 0, 0.2, 1]` maps to Reanimated's `Easing.bezier(0.4, 0, 0.2, 1)`.

- [x] T046 [US4] Verify WCAG AAA contrast compliance: Run accessibility audit on both platforms. (a) Web: Use axe DevTools browser extension on all pages at `http://localhost:3000` — verify 0 contrast violations. (b) Mobile: Manually verify text color against background for all text/background pairs listed in the design tokens. If any pair fails 7:1 (body) or 4.5:1 (large text), adjust the color token value in `packages/shared/src/constants/design-tokens.ts` (source of truth) and propagate to both platforms. Document any adjusted values in the design tokens file with a comment explaining the contrast fix.

**Verification for User Story 4**

- Run `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` — must pass
- Side-by-side comparison: Open dashboard and case detail on mobile (Expo Go) and web (localhost:3000). Verify identical colors, fonts, badge glow, glass-panel blur. See `quickstart.md` VS-4.
- Accessibility audit: Web axe DevTools reports 0 contrast violations. Mobile manual review of all text/background pairs.

---

## Phase 7: User Story 5 — AI-Powered Clinical Reflection Assistant (Priority: P3)

**Goal**: Residents access AI insights that analyze case history and provide supportive, evidence-based reflections — with streaming rendering, mandatory disclaimers, and safety guardrails.

**Independent Test**: Resident opens AI Insights panel, sees pre-generated insight cards, types a query, receives streaming response within 10 seconds, disclaimer is visible, response contains no diagnosis/prescription language.

### Implementation for User Story 5

- [x] T047 [P] [US5] Add streaming SSE support to Supabase AI edge function at `supabase/functions/ai-insights/index.ts`: Add a `stream` parameter check. When `body.stream === true`: (a) set response headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`; (b) stream the AI response token by token using the provider's streaming API (OpenAI: `stream: true`, Anthropic: `stream: true`, Azure: `stream: true`); (c) for each token, write `data: {"token": "<escaped_token>"}\n\n` to the response; (d) after all tokens, write `data: {"done": true, "tokens_used": <count>, "disclaimer_rendered": true, "safety_flags": <flags>}\n\n`; (e) append the mandatory disclaimer text to the final chunk if not already in response. The existing non-streaming code path must continue to work unchanged. Max 300 lines for the whole file.

- [x] T048 [P] [US5] Add AI safety guardrails to edge function in `supabase/functions/ai-insights/index.ts` (same file as T047 — extend): After receiving AI response (streaming or batch): (a) scan response text for prohibited patterns: diagnosis indicators (regex: `/(patient has|diagnosed with|suffers from|condition is)/i`), prescription indicators (regex: `/(prescribe|take \d+mg|dosage of|administer)/i`), prognosis indicators (regex: `/(will recover|likely to develop|prognosis is|life expectancy)/i`); (b) if any pattern matches, add the corresponding flag to `safety_flags` array (`blocked_diagnosis`, `blocked_prescription`, `blocked_prognosis`); (c) if safety flags are non-empty, prepend a warning to the response: "⚠️ Note: Some content was filtered to comply with medical safety guidelines. This is an educational tool only."; (d) always ensure the mandatory disclaimer is rendered by checking if the response contains the disclaimer substring; if not, append it.

- [x] T049 [P] [US5] Create mobile AI insights screen at `apps/mobile/app/(tabs)/ai-insights.tsx` (NEW file): Create a new screen with: (a) header "AI Clinical Insights" with a brain/sparkle icon; (b) pre-generated insight cards section (scroll horizontally): each card shows a metric (e.g., "Most Frequent: Laparoscopic Cholecystectomy — 12 cases") with a small chart icon; (c) text input at bottom for free-text questions with a "Ask AI" send button; (d) response area: a `ScrollView` that shows response text with progressive rendering (append each SSE token as it arrives); (e) a typing indicator (three animated dots) while waiting for first token; (f) loading state: shimmer skeleton for insight cards; (g) error state: "AI unavailable" message with retry button; (h) disabled/quota state: when AI is not enabled for resident, show upgrade prompt card with "Upgrade to Premium" text and a plan comparison link. Max 250 lines.

- [x] T050 [US5] Wire AI streaming client to mobile screen in `apps/mobile/app/(tabs)/ai-insights.tsx` (extend T049): Import `EventSource` from `react-native-sse`. On "Ask AI" press: (a) create an EventSource connection to `${SUPABASE_URL}/functions/v1/ai-insights` with headers `Authorization: Bearer ${token}` and POST body `JSON.stringify({ tenant_id, resident_id, query, stream: true })`; (b) on `eventSource.onmessage`: parse `event.data`, if `data.done` close connection, else append `data.token` to response state; (c) on `eventSource.onerror`: show error state with retry; (d) on `eventSource.onopen`: switch from typing indicator to response area; (e) ensure EventSource is cleaned up on component unmount (`.close()`).

- [x] T051 [US5] Add disclaimer display to mobile AI screen in `apps/mobile/app/(tabs)/ai-insights.tsx` (extend previous): After response is complete (receiving `done: true`): (a) display the disclaimer in a distinct banner at the bottom of the response: a subtle amber-bordered box with text "This is an educational reflection tool and does not constitute medical advice." in small Inter font; (b) if `safety_flags` array is non-empty, display each flag as a small warning chip below the disclaimer (e.g., "Diagnosis content filtered"); (c) the disclaimer must be permanently visible — not dismissible. Import the status from the SSE `done` event payload.

- [x] T052 [P] [US5] Add streaming response rendering to web AI panel at `apps/web/components/AIInsightsPanel.tsx`: Update the existing "Ask AI" functionality to support streaming. When the existing Supabase function invoke returns, check if `response_format === 'stream'`. For streaming: (a) call the edge function with `stream: true` via fetch (not Supabase client, which doesn't support SSE well); (b) use `EventSource` or `fetch` with `ReadableStream` to read the SSE stream; (c) progressively update the response display as tokens arrive; (d) show typing cursor animation while streaming. For non-streaming: keep existing behavior. Add the disclaimer banner as a fixed element below the response area.

- [x] T053 [US5] Add AI quota/disabled UX to web AI panel at `apps/web/components/AIInsightsPanel.tsx`: Before invoking AI: (a) check `resident_ai_toggle.enabled` for the current user; (b) check `ai_config.is_active` for the tenant; (c) if either is false, show an upgrade prompt card: "AI Insights require a Premium subscription" with a button linking to `/{tenant}/billing`; (d) if `quota_limit` is exceeded, show "Monthly AI queries exhausted. Upgrades available." with link to billing. The existing fetch for `resident_ai_toggle` in the admin panel may need to be added here — query Supabase directly.

**Verification for User Story 5**

- Run `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` — must pass
- Manual test: Login as resident with AI enabled, open AI Insights, verify insight cards, type query, verify streaming response, verify disclaimer visible, verify no diagnosis language in response
- Refer to `quickstart.md` VS-5 for full validation steps

---

## Phase 8: User Story 6 — Institution SaaS Management & Resident Tracking (Priority: P2)

**Goal**: Institution admins manage SaaS subscriptions, view plan comparisons, track resident performance across the program, upgrade plans, and manage billing — all with premium clinical design.

**Independent Test**: Admins logs into web dashboard, views current plan with resident count, browses resident performance table, upgrades plan, sees features activate immediately.

### Implementation for User Story 6

- [x] T054 [P] [US6] Redesign subscription plan cards at `apps/web/components/SubscriptionPlans.tsx`: Replace current plan display with premium comparison cards: (a) each card shows: plan name in Outfit font, price in large text with "/month", feature list with checkmark (teal) for included and cross (slate-500) for not included; (b) if card is the current plan, add a glowing teal border and "Current Plan" badge at top; (c) "Upgrade" button with teal gradient background on non-current plans, grayed out "Current" text on current plan; (d) cards laid out in responsive grid: 1 column mobile, 3 columns tablet, 5 columns desktop; (e) for institution plans, show "Up to X residents" badge; (f) use Framer Motion for card hover scale (`whileHover={{ scale: 1.02 }}`) and entrance stagger animation.

- [x] T055 [US6] Add institution-wide resident performance overview at `apps/web/app/(authenticated)/[tenant]/reports/page.tsx`: Replace or enhance the existing reports page with: (a) a HeroUI `<Table.Root>` showing all residents with columns: Resident Name, Specialty, Total Cases, Verified Cases, Verification Rate (%), Milestone Completion (%), Last Active; (b) table must be sortable by clicking column headers (use HeroUI `<Table.Column>` with `allowsSorting`); (c) add a filter bar above the table: search by resident name (text input), filter by specialty (HeroUI `<Select>` dropdown), filter by date range (cases logged between dates); (d) add an "Export PDF" button that calls the existing `/api/[tenant]/export-pdf` route with the filtered data; (e) the table must show a loading skeleton (shimmer rows) while data fetches — create 5 shimmer placeholder rows with HeroUI `<Skeleton>` or custom animated divs.

- [x] T056 [US6] Add loading skeletons for large dataset (200+ residents) at `apps/web/app/(authenticated)/[tenant]/reports/page.tsx` (extend T055): While the Supabase query is loading (use React `useTransition` or Suspense boundary): (a) render a skeleton table with 10 shimmer rows, each row having 6 shimmer cells (gray rectangles with CSS shimmer animation using `bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 animate-pulse`); (b) the skeleton must match the exact layout dimensions of the real table to avoid layout shift when real data loads; (c) use `React.Suspense` with a fallback skeleton component extracted to `apps/web/components/TableSkeleton.tsx` (accept props: `rows: number`, `columns: number`).

- [x] T057 [P] [US6] Add billing overview to admin panel at `apps/web/app/(authenticated)/[tenant]/admin/page.tsx`: Within the existing admin Tabs, ensure the billing/plan tab shows: (a) current subscription details: plan name, status (active/canceled/past_due with colored Chip), current period start/end dates, next billing date; (b) payment history: a table of past `payments` with date, amount, currency, gateway payment intent ID, status; (c) "Manage Subscription" button that opens Stripe Customer Portal or the checkout flow. Fetch data from `subscriptions` joined with `subscription_plans`, and `payments` filtered by tenant_id. This page already exists (`billing/page.tsx`) — enhance it with the premium card layout from T054.

- [x] T058 [P] [US6] Add plan upgrade confirmation flow to web at `apps/web/components/SubscriptionPlans.tsx` (extend T054): When "Upgrade" is clicked: (a) call `supabase.functions.invoke('create-checkout', { body: { tenant_id, plan_id, gateway: 'stripe' } })`; (b) on success, redirect to the returned `url` (Stripe Checkout); (c) on return from Stripe (success URL), show a celebration banner: emerald background with "Plan upgraded successfully! Features now active." and a checkmark animation. The existing `create-checkout` edge function already handles this — only add the UI confirmation.

- [x] T079 [P] [US6] Create program director "Program Overview" dashboard at `apps/web/app/(authenticated)/[tenant]/admin/overview/page.tsx` to satisfy FR-013: (a) fetch aggregated program data from `case_entries`, `profiles`, `program_goals`, and `case_templates` filtered by `tenant_id`; (b) render an animated donut chart showing resident completion rates by status (draft/pending/approved/rejected) using inline SVG with Framer Motion; (c) render a sortable pending verification table with columns: Resident Name, Specialty, Pending Cases, Days Since Last Activity; (d) render a color-coded horizontal bar chart showing specialty distribution with hover tooltips; (e) animate all charts on viewport entry with staggered 50ms delays using the shared `STAGGER_DELAY` constant; (f) add a link from the admin page tabs to this new overview. Max 400 lines; extract chart components to `apps/web/components/ProgramOverviewCharts.tsx` if needed.

- [x] T082 [P] [US6] Implement institutional subscription lapse read-only mode to satisfy FR-025: In `apps/web/app/(authenticated)/[tenant]/layout.tsx` (or a new subscription status provider): (a) query `subscriptions` joined with `subscription_plans` for the current tenant; (b) if status is `past_due` or `unpaid`, set a global read-only flag and show a non-dismissible amber banner: "Subscription renewal required — logging is temporarily disabled. Renew now to restore full access." with a link to `/{tenant}/billing`; (c) disable the "Log New Case" button and case submission forms in mobile and web; (d) allow supervisors to continue viewing and approving cases logged before the lapse; (e) when status becomes `active`, remove the banner and re-enable write features immediately. Add a matching backend RLS policy or application guard to reject new `case_entries` inserts from lapsed tenants.

- [x] T059 [P] [US6] Add subscription management to mobile profile at `apps/mobile/app/(tabs)/profile.tsx`: Enhance the existing profile screen with: (a) current plan display: show plan name with a colored badge (Free = slate, Premium = teal, Institution = indigo); (b) if individual resident on Free plan: show "Upgrade to Premium" card with 3 key benefits (AI insights, PDF export, unlimited cases) and a "Subscribe" button that opens the web billing URL in browser (use `Linking.openURL`); (c) if on Premium plan: show "Manage Subscription" with next billing date; (d) if part of institution: show institution name and plan; (e) add a "Billing History" section with a `FlatList` of recent payments (if individual) or "Managed by your institution" text.

**Verification for User Story 6**

- Run `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` — must pass
- Manual test: Login as `admin@demo.com`, verify billing dashboard, verify resident tracking table with sorting, verify plan upgrade flow
- Refer to `quickstart.md` VS-6 for full validation steps

---

## Phase 9: Offline Sync & Conflict Resolution (Cross-Cutting — Supports US1)

**Purpose**: Complete the WatermelonDB + Supabase sync infrastructure that enables US1's offline capability and FR-024's conflict resolution. Tasks are labeled [US1] because offline sync is infrastructure for the case logging user story.

- [x] T060 [P] [US1] Install and configure `@react-native-community/netinfo` in `apps/mobile/lib/sync.ts`: Import `NetInfo` from `@react-native-community/netinfo`. Add a `NetInfo.addEventListener` in the SyncService constructor that listens for connectivity changes. When `state.isConnected` transitions from `false` to `true`: call `this.pushPendingCases()` and `this.pullTemplates(tenantId)`. When transitioning from `true` to `false`: update status to `'offline'`. Store the subscription reference for cleanup. Export a `cleanup()` method that unsubscribes.

- [x] T061 [US1] Wire pushPendingCases to WatermelonDB + Supabase in `apps/mobile/lib/sync.ts`: Implement the actual push logic: (a) query WatermelonDB `case_entries` collection for records where `local_sync_status === 'pending' OR local_sync_status === 'error'`; (b) for each draft, set `local_sync_status = 'syncing'`, then call `supabase.from('case_entries').insert(caseData)`; (c) on success (201): update WatermelonDB record — set `id` to the server-returned UUID, `local_sync_status = 'synced'`, and remove from AsyncStorage via `removeDraftCase(key)`; (d) on error (409 — conflict): load the server version of the case via `supabase.from('case_entries').select().eq('id', caseData.id).single()`, compare `updated_at`, if server is newer: create a NEW WatermelonDB record with the local edits and `local_sync_status = 'conflict'`, trigger a notification via `SyncService.onConflict(residentId, entryId)`; (e) on network/5xx error: set `local_sync_status = 'error'` and schedule retry with exponential backoff (30s, 60s, 120s, max 300s).

- [x] T062 [US1] Implement periodic sync interval in `apps/mobile/lib/sync.ts`: Add a `startPeriodicSync(intervalMs = 30000)` method that calls `pushPendingCases()` every `intervalMs` milliseconds when online. Use `setInterval` stored as a class property. Add `stopPeriodicSync()` to clear the interval. Call `startPeriodicSync()` when the app comes to foreground (use React Native `AppState` listener). Call `stopPeriodicSync()` when app goes to background.

- [x] T063 [US1] Implement template caching in WatermelonDB via `apps/mobile/lib/sync.ts`: Implement `pullTemplates(tenantId)`: (a) fetch from `supabase.from('case_templates').select().eq('tenant_id', tenantId)`; (b) for each template, upsert into WatermelonDB `case_templates` collection (create if not exists, update if `updated_at` is newer); (c) store `last_template_sync` timestamp in AsyncStorage. Update `apps/mobile/app/(tabs)/log-case.tsx` Phase 1 to read templates from WatermelonDB first (faster, offline-capable), falling back to Supabase if WatermelonDB is empty.

- [x] T064 [US1] Add conflict notification infrastructure in `apps/mobile/lib/sync.ts`: Add method `onConflict(residentId: string, entryId: string)`: (a) store conflict info in AsyncStorage under `conflict_<entryId>` key with `{ entryId, residentId, timestamp }` JSON; (b) call the notification callback (set via `SyncService.setConflictCallback(cb)`) so the UI layer can show the conflict banner. Export a `getConflictDrafts()` helper that reads all `conflict_*` keys from AsyncStorage and returns them as an array. The UI integration (banner display in my-cases.tsx) is handled in T068.

**Verification for Offline Sync**

- Run `pnpm --filter @elogbook/mobile typecheck` — must pass
- Manual test: Airplane mode → log case → confirm local save → disable Airplane → confirm auto-sync within 30s with zero data loss. Test conflict: edit case offline while supervisor rejects same case server-side → verify conflict draft created with notification. See `quickstart.md` VS-7 and VS-8.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final quality improvements across all user stories — concurrency control, notifications, error handling, performance measurement, compliance configuration, design audit, database verification, accessibility, and enterprise readiness.

- [x] T065 [P] Add optimistic concurrency control for supervisor approval in Supabase: Create a new migration `supabase/migrations/00009_concurrent_approval_lock.sql` that adds database functions `approve_case(p_entry_id UUID, p_supervisor_id UUID, p_comment TEXT DEFAULT NULL)` and `reject_case(p_entry_id UUID, p_supervisor_id UUID, p_comment TEXT DEFAULT NULL)`. Each function: (a) uses `SELECT ... FOR UPDATE` to lock the `case_entries` row; (b) checks if status is still 'pending' — if already approved/rejected, returns a JSONB with `code: 'already_reviewed'`; (c) if pending, updates `case_entries.status`, upserts `approval_requests`, and returns a JSONB with `success: true`; (d) relies on the existing audit trigger to log mutations automatically. This migration MUST be applied before T030 is functionally complete. T030 is responsible for wiring the mobile UI to these RPC functions.

- [x] T066 [P] Implement in-app notification system on mobile for approval/rejection: Create `apps/mobile/lib/notifications.ts` with a `useCaseNotifications()` hook that: (a) polls Supabase `approval_requests` every 60 seconds where `entry_id` is in resident's case list and `status` changed since last poll (tracked via AsyncStorage `last_notification_check`); (b) if new approval: add a badge count to the profile tab icon; (c) if new rejection: show an in-app banner at top of screen (not system notification) with supervisor's comment and "View" button navigating to case detail; (d) integrate into `apps/mobile/app/(tabs)/_layout.tsx` — add badge count to tab bar icon using `tabBarBadge` option on the profile tab. This satisfies FR-014.

- [x] T067 [P] Add rejection feedback UX to web case detail at `apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx`: When a case status is `'rejected'`: (a) display the supervisor's rejection comment in a crimson-bordered box at the top of the case detail; (b) show an "Edit & Resubmit" button that navigates to a pre-filled case form with the rejected case's data; (c) the resubmitted case creates a NEW `case_entries` record (not overwriting the rejected one) with status `'draft'` or `'pending'` depending on tenant type. This satisfies FR-015.

- [x] T068 [P] Implement rejection resubmission and conflict display on mobile in `apps/mobile/app/(tabs)/my-cases.tsx`: (a) When a case card with status `'rejected'` is tapped: navigate to a pre-filled case form (similar to `log-case.tsx` but with existing data), show the rejection comment at top in crimson banner, allow editing all fields, on submit create new case entry (POST to Supabase) — do NOT update the rejected entry; (b) Add a "Rejected" filter chip at the top of the case list to filter by status; (c) On mount, call `getConflictDrafts()` from `@/lib/sync` (T064) — for each conflict draft, show an amber banner at top of case list: "Case updated by supervisor — offline edits saved as new draft" with a "View Draft" button that navigates to the conflict draft detail; (d) Add a "Conflicts" filter chip alongside the "Rejected" chip to filter conflict drafts.

- [x] T069 [P] Add design consistency measurement for SC-005: Create `specs/001-premium-mobile-logbook/checklists/design-consistency-audit.md` with a scoring rubric that lists every DESIGN.md token category (colors: 6 tokens, typography: 3 fonts × 4 text types, elevation: 3 panel types, motion: 4 animation types, component states: 5 states) — each item scored 0 (no match), 0.5 (partial match), 1 (exact match). Both mobile and web screens are scored individually. Target is 95%+ overall score. Run audit against all screens post-implementation and document results.

- [x] T070 [P] Add performance measurement infrastructure: (a) Web: Add Vercel Analytics or custom Performance API instrumentation to measure dashboard render time (target <3s for 500 residents per SC-012) and API response times (target <500ms p95 per SC-014) — add `apps/web/lib/performance.ts` with `measurePageLoad(pageName)` and `measureApiCall(endpoint, duration)` functions using `performance.now()` and `navigator.sendBeacon` for reporting; (b) Mobile: Add React Native Performance Monitor or custom `performance.now()` instrumentation to measure case logging completion time (target <60s per SC-001) and sync completion time (target <30s per SC-006) — add `apps/mobile/lib/performance.ts` with matching functions.

- [x] T071 [P] Add enterprise readiness infrastructure: (a) Configure Supabase point-in-time recovery (PITR) with 7-day recovery window for SC-013 disaster recovery requirement — document in `supabase/README.md` the DR procedure: restore from PITR, verify RLS, run `supabase db reset`, verify seed data, redirect DNS; (b) Add health check endpoint at `apps/web/app/api/health/route.ts` returning `{ status: 'ok', timestamp, uptime }` for monitoring integration; (c) Document in `docs/operations.md`: deployment process, environment variables checklist, backup restore procedure, incident response contacts.

- [x] T072 [P] Add compliance framework configuration UI: Update `apps/web/app/(authenticated)/[tenant]/admin/page.tsx` Admin Tabs to include a "Compliance" tab that: (a) allows institution_admin to select applicable frameworks (checkboxes: HIPAA, GDPR, SCFHS, GMC, PIPEDA, Australian Privacy Act) — saves to `tenants.compliance_frameworks TEXT[]`; (b) shows the configured data residency region (read-only from `tenants.region`); (c) allows setting data retention period in days (`tenants.data_retention_days`, default 2555); (d) toggles consent requirement (`tenants.consent_required`); (e) displays a summary of active compliance measures (de-identification, encryption, audit trails, RLS). Use the `complianceConfigSchema` from `@elogbook/shared` for validation.

- [x] T073 [P] Schedule external security validation for SC-009: Document the process in `docs/security-audit.md`: (a) Engage external penetration testing firm to test the deployed application against OWASP Top 10; (b) Commission a Data Protection Impact Assessment (DPIA) covering HIPAA and GDPR requirements; (c) Run internal vulnerability scan using `supabase test db` and `npm audit`; (d) Document compliance evidence: audit trail completeness (query audit_logs for 100% coverage), encryption verification (confirm ai_config secrets encrypted), RLS policy test results. Target: zero critical findings in a single audit cycle.

- [x] T074 Apply design token alignment to CompetencyManager at `apps/web/components/CompetencyManager.tsx`: Update the existing accreditation framework manager to use the shared clinical design tokens: (a) replace any hardcoded colors with Tailwind classes using the clinical color palette (teal primary, indigo secondary, slate-indigo backdrop); (b) apply the `.panel` class to framework cards; (c) use the `<ProgressRing>` component (from T039) to display milestone completion percentages within each framework; (d) ensure delete confirmation uses `<GlassPanel>` or modal with glass-panel styling (FR-016). Max 100 lines added.

- [x] T080 [P] Validate institution dashboard performance for SC-012: Seed the local database with 500 mock residents and associated case entries (use a temporary Supabase seed script or SQL insert). Load `apps/web/app/(authenticated)/[tenant]/reports/page.tsx` and the new Program Overview dashboard (T079). Measure page load time with the instrumentation from T070. If either page exceeds 3 seconds, optimize the Supabase queries (add indexes, reduce joins, or paginate) until the target is met. Document the final query plan and timing in `docs/performance.md`.

- [x] T081 [P] Validate API concurrency for SC-014: Run a load test against the Supabase REST API or a local k6/Artillery script simulating 5,000 concurrent active users with burst traffic to 10,000. Target endpoints: case submission, case list fetch, approval RPC, and AI insights. Use the instrumentation from T070 to confirm p95 API response time remains below 500ms. If the target is missed, document bottlenecks and add caching, connection pooling, or rate-limiting tasks as follow-ups.

- [x] T075 [P] Run Supabase database verification: Execute `supabase test db` to verify all RLS policies are intact after all migrations (00008 and 00009). Run `supabase db reset` and confirm seed data applies cleanly with all new columns. Check that `demo` accounts still work with the new schema.

- [x] T076 [P] Run full TypeScript typecheck across all packages: `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck && pnpm --filter @elogbook/shared typecheck` — must all pass with zero errors.

- [x] T077 [P] Run full lint verification across apps: `pnpm --filter @elogbook/web lint && pnpm --filter @elogbook/mobile lint` — must all pass with zero warnings.

- [x] T078 Final validation: Run through ALL 8 quickstart validation scenarios (VS-1 through VS-8) from `specs/001-premium-mobile-logbook/quickstart.md`. Also run the SC-005 design consistency audit from T069. Document any failures. Fix issues. Re-run until all scenarios and audits pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (shared types, migration, design tokens MUST exist first)
- **User Stories (Phase 3–8)**: All depend on Phase 2 completion
  - US1 and US2 can proceed in parallel (different apps/components, no shared state)
  - US3 depends on US1 completion (needs case submissions to have progress data)
  - US4 depends on US1+US2+US3 (applies design consistency TO existing screens)
  - US5 and US6 can proceed in parallel after Phase 2 (independent screens)
- **Offline Sync (Phase 9)**: Depends on US1 completion (needs the log-case screen to exist for sync integration)
- **Polish (Phase 10)**: Depends on all user stories

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — No dependencies on other stories. Provides cases data for US2 and US3.
- **US2 (P1)**: Can start after Phase 2 — Needs at least one pending case to test (use demo seed data or create manually). Independent of US1 implementation but shares Supabase tables.
- **US3 (P2)**: Start after US1 and US2 — Needs verified cases to show progress. Can develop UI with mock data while US1/US2 complete.
- **US4 (P2)**: Start after US1+US2+US3 — Applies tokens to existing screens. Can develop tokens/shared infra in parallel.
- **US5 (P3)**: Can start after Phase 2 — Independent screen, only needs Supabase edge function. Parallel to US1-US4.
- **US6 (P2)**: Can start after Phase 2 — Independent admin screens. Parallel to US1-US5.

### Within Each User Story

- Models/schemas before components
- Components before page integration
- Core implementation before edge cases
- Edge cases before moving to next story

### Parallel Opportunities

- T001–T010 can all run in parallel (Phase 1 — all different files)
- T012–T017 can all run in parallel (Phase 2 — all different files, after T011)
- T019 and T020 can run in parallel (US1 — mobile vs web, different codebases)
- T028 and T031 can run in parallel (US2 — mobile vs web)
- T035 and T037 can run in parallel (US3 — mobile vs web)
- T040, T041, T042, T043 can run in parallel (US4 — different files)
- T047, T048, T049, T052 can run in parallel (US5 — all different files)
- T054, T057, T058, T059 can run in parallel (US6 — different files)
- US1 and US2 can be developed in parallel by different team members
- US5 and US6 can be developed in parallel with US1-US4
- Phase 9 tasks (T060–T064) depend on US1 completion but can run in parallel with other stories
- T065–T074 (Phase 10) can all run in parallel — all different files

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (Case Logging)
4. Complete Phase 4: User Story 2 (Verification Dashboard)
5. **STOP and VALIDATE**: Test US1 and US2 independently. These two stories deliver the core logbook loop — residents log cases, supervisors verify them.
6. Deploy/demo if ready. This is the minimum viable product.

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (Case Logging) → Test independently → MVP milestone
3. Add US2 (Verification Dashboard) → Test independently → Core loop complete
4. Add US3 (Progress Tracking) → Test independently → Resident engagement
5. Add US6 (SaaS Billing) → Test independently → Monetization ready
6. Add US4 (Design Consistency) → Test → Visual polish
7. Add Offline Sync (Phase 9) → Test → Offline capability
8. Add US5 (AI Insights) → Test → AI differentiation
9. Polish (Phase 10) → Final quality gate

### Parallel Team Strategy (3 developers)

1. All: Phase 1 + Phase 2 together (Setup + Foundational)
2. Once Phase 2 done:
   - **Developer A**: US1 (Case Logging) → then US4 (Design Consistency)
   - **Developer B**: US2 (Verification Dashboard) → then US6 (SaaS Billing)
   - **Developer C**: US5 (AI Insights, edge function) → then US3 (Progress) → then Phase 9 (Offline Sync)
3. All: Phase 10 (Polish) together

---

## Notes

- [P] tasks = different files, no dependencies within same phase
- [Story] label maps task to user story for traceability
- Each user story should be independently completable and testable
- Verify TypeScript typecheck passes after each phase checkpoint
- Verify lint passes after each phase checkpoint
- Every task includes exact file path — no file discovery needed by AI
- Imports are specified where needed to prevent AI guessing
- Commit after each phase or logical task group
- Stop at any checkpoint to validate story independently
- File size: keep modified files under 400 lines; extract sub-components if approaching 800
