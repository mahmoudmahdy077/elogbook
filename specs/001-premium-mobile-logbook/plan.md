# Implementation Plan: Premium Mobile Logbook

**Branch**: `001-premium-mobile-logbook` | **Date**: 2026-06-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-premium-mobile-logbook/spec.md`

## Summary

Transform the E-Logbook into an enterprise-grade, mobile-first clinical logbook for junior residents and doctors. The implementation upgrades the UI/UX across web and mobile using HeroUI design primitives with the Impeccable Clinical Design System, adds AI-powered clinical reflections, implements global medical compliance (HIPAA/GDPR/SCFHS/GMC/PIPEDA), integrates SaaS billing for institutions and individual residents, and hardens performance for 5,000 concurrent users. The existing monorepo structure (Next.js 16 web, Expo 56 mobile, Supabase backend, shared Zod schemas) is leveraged and extended rather than replaced.

## Technical Context

**Language/Version**: TypeScript 6.0 (strict mode), PostgreSQL 15, Deno (Edge Functions)

**Primary Dependencies**: Next.js 16 (App Router), Expo SDK 56 + React Native 0.85, Supabase (auth, db, functions), HeroUI `@heroui/react` v3.1, Tailwind CSS v4, NativeWind v4, Framer Motion v12, React Native Reanimated, WatermelonDB 0.28, Zod v4, date-fns v4, expo-haptics, react-native-svg, @react-native-community/blur, @react-native-community/netinfo, react-native-sse

**Storage**: Supabase PostgreSQL 15 (primary, RLS-enabled, 22 tables), WatermelonDB + SQLite (mobile offline), AsyncStorage (draft persistence)

**Testing**: Vitest (`@elogbook/shared`), `supabase test db` (RLS policies), manual device testing (mobile offline/online cycles)

**Target Platform**: Web (Next.js 16, all modern browsers), iOS 16+ / Android 13+ (Expo), Supabase Edge Functions (Deno Deploy)

**Project Type**: Monorepo — web application + mobile application + shared validation/types package + Supabase backend

**Performance Goals**: 500ms p95 API response (5K concurrent), 60fps animations (mobile), <3s dashboard render (500 residents), <60s case logging, <15s verification action, <10s AI response, 99.9% uptime

**Constraints**: WCAG AAA contrast (7:1 body, 4.5:1 large), HIPAA/GDPR/SCFHS/GMC/PIPEDA compliance, offline-first mobile (no-signal OR/radiology wards), de-identification by default, write-once immutability, tenant-level data residency tagging, file size <800 lines

**Scale/Scope**: 5,000 concurrent users (burst 10,000), 500+ residents per institution, 10+ global jurisdictions, 6 user stories, 25 functional requirements, 14 success criteria, 54 UX quality checklist items

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Security & Compliance First ✅

- **De-identification by default**: Existing `case_entries.is_deidentified` defaults to `true`. PII fields nullable. No changes required.
- **Write-once immutability**: Existing `write_once_submitted_check` trigger. FR-024 adds server-authoritative sync conflict resolution — consistent with principle.
- **RLS**: All 22 tables already RLS-enabled. No new tables bypass this.
- **Audit trails**: Existing `audit_case_entry` trigger covers case mutations. AI queries already logged to `ai_query_logs`. FR-023 adds AI response disclaimer logging.
- **Encryption at rest**: `ai_config` and `payment_gateway_config` secrets already encrypted. No new secrets introduced.
- **Subscription lapse isolation**: FR-025 adds a read-only grace period for lapsed institutional tenants; this is enforced via subscription status checks and does not bypass tenant isolation or RLS.

**Verdict**: PASS — existing infrastructure satisfies principle; no regressions.

### II. Clinical Precision UX ✅

- **Design system compliance**: FR-008 mandates HeroUI primitives. FR-011 enforces slate-indigo backdrop. FR-012 enforces Outfit/Inter/Geist Mono fonts. FR-016 enforces glass-panel styling.
- **Anti-pattern enforcement**: DESIGN.md rules unchanged. New UX checklist (CHK001–054) validates compliance.
- **Accessibility**: SC-007 mandates WCAG AAA. CHK045–047 cover contrast, focus, motion sensitivity.
- **Motion discipline**: FR-006/003 define animations. CHK048–050 validate consistency.

**Verdict**: PASS — all UI changes governed by DESIGN.md and UX checklist.

### III. Schema-Driven Development ✅

- **Shared types first**: New entities (Subscription Plan, AI Insight Query, Institution Billing Record, Compliance Configuration) already exist in `packages/shared/src/types/database.ts`. FR-022 (data residency) adds a `region` field to tenants — requires minor type update.
- **Zod as contract**: FR-023 (AI guardrails) needs a new `aiQuerySchema` in `packages/shared/src/schemas/`. FR-019/020 (SaaS billing) needs subscription schema enhancements.
- **No duplicate types**: All components import from `@elogbook/shared`. No redefinitions.

**Verdict**: PASS — minor schema additions required, no architectural changes.

### IV. Offline-First Mobile ✅

- **Local database**: WatermelonDB already configured. SyncService exists but not wired — FR-010 and FR-024 will complete the integration.
- **Sync engine**: FR-024 defines server-authoritative conflict resolution. Offline indicator specified in FR-010.
- **Draft persistence**: AsyncStorage draft helpers already exist in `apps/mobile/lib/db/storage.ts`.
- **Templates offline**: Case templates fetched from Supabase — need WatermelonDB caching (gaps in current code).

**Verdict**: PASS — existing infrastructure needs wiring, not replacement.

### V. Role-Based Multi-Tenancy ✅

- **Tenant isolation**: Existing RLS policies cover all tables. JWT claims carry `tenant_id` and `user_role`.
- **Role hierarchy**: Resident < Supervisor < Director < Institution Admin < Admin. No changes needed.
- **Auto-provisioning**: `on_auth_user_created` trigger handles individual tenants. Institution tenant creation via admin panel (existing `UserManager.tsx`).
- **UI gating**: FR-019/020/021 (SaaS dashboards) need role-based visibility — consistent with existing pattern.

**Verdict**: PASS — existing multi-tenancy architecture accommodates new features.

### Overall Gate Result: ✅ ALL GATES PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/001-premium-mobile-logbook/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── ai-insights.md   # AI insights API contract
│   ├── billing.md       # SaaS billing API contract
│   └── sync.md          # Offline sync contract
├── checklists/
│   ├── requirements.md  # Spec quality checklist
│   └── ux.md            # UX requirements quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
apps/web/                        # Next.js 16 web application
├── app/
│   ├── (authenticated)/[tenant]/
│   │   ├── dashboard/           # [MODIFY] Enhanced KPI rings, AI insights widget
│   │   ├── cases/               # [MODIFY] Redesigned case form wizard, detail view
│   │   ├── approvals/           # [MODIFY] Premium verification dashboard
│   │   ├── goals/               # [MODIFY] Animated progress rings
│   │   ├── reports/             # [MODIFY] Institution-wide analytics
│   │   ├── billing/             # [MODIFY] SaaS subscription management
│   │   └── admin/               # [MODIFY] Compliance config, AI config
│   │       └── overview/        # [NEW] Program director analytics dashboard (FR-013)
│   ├── api/
│   │   └── health/              # [NEW] Health check endpoint for monitoring
│   └── globals.css              # [MODIFY] Enhanced glass-panel, motion tokens
├── components/
│   ├── DashboardContent.tsx     # [MODIFY] AI insights widget, SaaS KPIs, progress rings
│   ├── CaseForm.tsx             # [MODIFY] Step indicator wizard, de-identification help
│   ├── ProgressRing.tsx          # [NEW] Reusable SVG progress ring component
│   ├── TableSkeleton.tsx         # [NEW] Reusable shimmer loading skeleton for tables
│   ├── ProgramOverviewCharts.tsx # [NEW] Donut/bar charts for director dashboard
│   ├── ApprovalsDashboard.tsx   # [MODIFY] Glass-panel cards, KPI counters, urgency
│   ├── ApprovalActions.tsx      # [MODIFY] Celebration animation
│   ├── SubscriptionPlans.tsx    # [MODIFY] Premium comparison cards, upgrade flow
│   ├── CompetencyManager.tsx    # [MODIFY] Design token alignment with progress rings
│   ├── AIInsightsPanel.tsx      # [MODIFY] Streaming response, disclaimer, quota UX
│   └── EmptyState.tsx           # No changes needed

apps/mobile/                     # Expo SDK 56 mobile application
├── app/
│   ├── (tabs)/
│   │   ├── index.tsx            # [MODIFY] Premium dashboard, KPI rings
│   │   ├── log-case.tsx         # [MODIFY] One-thumb form, offline indicator
│   │   ├── my-cases.tsx         # [MODIFY] Glass-panel cards, status badges
│   │   ├── approvals.tsx        # [REWRITE] Full verification dashboard
│   │   ├── ai-insights.tsx      # [NEW] AI clinical reflection panel
│   │   └── profile.tsx          # [MODIFY] Subscription management
├── lib/
│   ├── sync.ts                  # [MODIFY] Server-authoritative conflict resolution
│   ├── db/
│   │   ├── storage.ts           # [MODIFY] Enhanced draft management
│   │   └── database.ts          # [MODIFY] Sync protocol activation
├── global.css                   # [MODIFY] NativeWind clinical tokens
└── tailwind.config.js           # [MODIFY] Design token mapping

packages/shared/                 # Shared types and schemas
├── src/
│   ├── types/database.ts        # [MODIFY] Add region, compliance fields
│   ├── schemas/cases.ts         # [MODIFY] Add aiQuerySchema
│   ├── schemas/auth.ts          # [MODIFY] Add compliance preferences
│   └── schemas/subscriptions.ts # [MODIFY] Add institution billing schema
```

**Structure Decision**: The existing monorepo structure (`apps/web`, `apps/mobile`, `packages/shared`, `supabase/`) is maintained. No new packages are created. The feature extends existing components and adds new mobile screens. Web components are enhanced with HeroUI primitives; mobile screens are brought to visual parity via NativeWind design tokens. No architectural reorganization needed.

## Complexity Tracking

> No constitution violations to justify. All five principles are satisfied by existing architecture. Feature extends rather than replaces.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | — | — |
