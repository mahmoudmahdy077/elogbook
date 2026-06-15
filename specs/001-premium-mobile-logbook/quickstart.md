# Quickstart: Premium Mobile Logbook Validation

**Feature**: [spec.md](./spec.md) | **Date**: 2026-06-11

## Prerequisites

- Node.js 20+ and pnpm 9+
- Supabase CLI (`supabase --version`)
- Expo CLI (`npx expo --version`)
- Expo Go app on physical device (iOS/Android) for mobile testing

## Setup

```bash
# 1. Install dependencies (from repo root)
pnpm install

# 2. Start Supabase local development
supabase start

# 3. Apply all migrations and seed data
supabase db reset

# 4. Start web dev server
pnpm dev:web
# → Opens http://localhost:3000

# 5. Start mobile dev server (separate terminal)
pnpm dev:mobile
# → Scan QR code with Expo Go
```

## Validation Scenarios

### VS-1: Premium Case Logging (US1 — P1)

**Goal**: Verify one-thumb case logging with premium HeroUI design and haptic feedback.

```bash
# Pre-condition: Login as resident@demo.com / password123!
```

1. Navigate to "Log New Case" tab
2. **Check**: Template specialty cards render with medical icons, specialty name, required field count in premium HeroUI card layout [FR-001]
3. Select "General Surgery Log"
4. **Check**: Form fields are within thumb reach (lower 60% of screen); Submit button always visible [FR-002]
5. Fill all required fields with minimal taps
6. **Check**: Form auto-advances through sections; no two-hand interaction needed [US1-Acceptance-2]
7. Tap "Submit for Verification"
8. **Check**: Celebratory animation plays, haptic feedback triggers (Success pattern), confirmation screen appears [FR-003]
9. **Check**: Case status shows "Pending" in my-cases list with glowing amber badge [FR-009]

### VS-2: Verification Dashboard (US2 — P1)

**Goal**: Verify supervisor verification workflow with glass-panel design.

```bash
# Pre-condition: Login as supervisor@demo.com / password123!
# Pre-condition: At least 1 pending case exists (submit one as resident first)
```

1. Navigate to Approvals tab
2. **Check**: Animated KPI counters show pending/today/week totals with count-up animation [US2-Acceptance-1]
3. **Check**: Pending cases grouped by resident with profile avatars, specialty badges, relative time ("2 hours ago") [FR-004]
4. Tap a pending case
5. **Check**: Glass-panel overlay slides up with spring animation; case fields, procedure details, resident notes visible [FR-005]
6. **Check**: Approve button has emerald glow; Reject button has crimson glow [FR-005]
7. Tap "Approve"
8. **Check**: Celebration micro-animation plays; card exits pending list with directional slide [FR-006]
9. **Check**: Case status updated to "Approved" with glowing emerald badge [FR-009]

### VS-3: Progress Dashboard (US3 — P2)

**Goal**: Verify animated progress rings with glow effects.

```bash
# Pre-condition: Login as resident@demo.com
# Pre-condition: Multiple cases logged and approved across specialties
```

1. Navigate to Dashboard/Goals tab
2. **Check**: Animated SVG progress rings render per specialty with glowing completion arcs [FR-007]
3. **Check**: Ring animation triggers on viewport entry (staggered if multiple rings)
4. **Check**: Percentage label displayed inside ring
5. Tap a progress ring
6. **Check**: Detail view expands showing chronological timeline of verified cases with status badges and approving supervisor name [US3-Acceptance-3]

### VS-4: Cross-Platform Consistency (US4 — P2)

**Goal**: Verify visual identity parity between mobile and web.

1. Open same case detail on mobile (Expo Go) and web (localhost:3000) side by side
2. **Check**: Backdrop color is identical dark slate-indigo (`#060814`) [FR-011]
3. **Check**: Heading font is Outfit on both platforms [FR-012]
4. **Check**: Clinical data (MRN hash, dates) renders in Geist Mono on both platforms [FR-012]
5. **Check**: Status badge (pending/approved) has identical glowing style on both [FR-009]
6. **Check**: Glass-panel overlay styling is visually identical — blur effect, translucent border, diffused shadow [FR-016]
7. **Check**: Interactive elements (buttons, toggles, chips) have identical hover/focus/active states [US4-Acceptance-2]

### VS-5: AI Insights (US5 — P3)

**Goal**: Verify AI clinical reflection with safety guardrails.

```bash
# Pre-condition: AI enabled in admin panel (admin@demo.com)
# Pre-condition: Login as resident@demo.com with 20+ logged cases
```

1. Navigate to AI Insights panel
2. **Check**: Pre-generated insight cards show case volume trends, frequent procedures, specialty distribution with charts [US5-Acceptance-1]
3. Type query: "What patterns do you see in my surgical cases this month?"
4. **Check**: Response streams progressively (if streaming) or appears within 10 seconds [US5-Acceptance-2]
5. **Check**: Response does NOT contain diagnosis, prescription, or prognosis language [FR-023]
6. **Check**: Mandatory disclaimer "This is an educational reflection tool and does not constitute medical advice." is visible [FR-023]
7. **Check**: AI query logged to `ai_query_logs` with `disclaimer_rendered = true` [FR-023]

### VS-6: SaaS Billing (US6 — P2)

**Goal**: Verify institution subscription management.

```bash
# Pre-condition: Login as admin@demo.com (institution_admin)
```

1. Navigate to Billing tab
2. **Check**: Current plan displayed with plan name, active resident count, next billing date [US6-Acceptance-1]
3. **Check**: "Upgrade Plan" button with plan comparison cards showing features with checkmark/cross icons [FR-019]
4. Navigate to Admin → Resident Tracking
5. **Check**: Sortable resident table with case counts, verification rates, milestone percentages, last active dates [FR-021]
6. **Check**: PDF export button available [US6-Acceptance-2]

### VS-7: Offline Sync (Cross-cutting)

**Goal**: Verify offline case logging and sync conflict resolution.

```bash
# Pre-condition: Login as resident@demo.com on mobile
```

1. Enable Airplane mode on device
2. **Check**: Yellow "Offline mode" banner appears [FR-010]
3. Log a new case (any template)
4. **Check**: Case saved locally; appears in my-cases with offline indicator [FR-010]
5. Disable Airplane mode
6. **Check**: Auto-sync triggers within 30 seconds [SC-006]
7. **Check**: Synced case appears on web dashboard with correct data (zero loss) [SC-006]
8. **Check**: Sync status indicator transitions: syncing (blue pulse) → synced (green checkmark) [FR-010]

### VS-8: Offline Sync Conflict (Cross-cutting)

**Goal**: Verify server-authoritative conflict resolution.

```bash
# Pre-condition: Login as resident@demo.com on mobile AND supervisor@demo.com on web
```

1. Resident: enable Airplane mode, edit an existing draft case, save
2. Supervisor: on web, reject the same case with comment "Incomplete procedure details"
3. Resident: disable Airplane mode
4. **Check**: Sync detects server change; server state (rejected) preserved [FR-024]
5. **Check**: Resident's offline edits saved as new draft [FR-024]
6. **Check**: Conflict notification banner appears: "Case updated by supervisor. Your offline edits saved as new draft." [FR-024]
7. **Check**: One-tap "Resubmit" button available on conflict draft [FR-024]

## TypeScript & Lint Verification

```bash
# Run before declaring any task complete
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/mobile typecheck
pnpm --filter @elogbook/shared typecheck

pnpm --filter @elogbook/web lint
pnpm --filter @elogbook/mobile lint

# If migrations changed
supabase db reset
```

## Database Verification

```bash
# Verify RLS policies function correctly
supabase test db

# Verify audit trigger captures all changes
# Query audit_logs after any case mutation — record must exist
```

## Success Criteria Measurement

| SC | Measurement Method | Tool |
|----|--------------------|------|
| SC-001 (<60s logging) | Timed session with stopwatch | Manual test, 10 residents × 3 cases |
| SC-002 (90% one-thumb) | Thumb-zone heatmap overlay | Design review + user testing |
| SC-003 (<15s verification) | Timed session | Manual test |
| SC-004 (SUS 85+) | System Usability Scale survey | 20 medical residents post-usage |
| SC-005 (95% consistency) | DESIGN.md token checklist audit | Side-by-side comparison |
| SC-006 (<30s sync, zero loss) | Timed auto-sync with data integrity check | 100 offline-online cycles |
| SC-007 (100% WCAG AAA) | Contrast ratio checker | axe DevTools / Lighthouse |
| SC-008 (30% engagement increase) | Compare weekly case counts | Analytics before/after launch |
