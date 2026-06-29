# E-Logbook Enterprise — Complete Project Analysis

> **Generated**: 2026-06-23 | **Purpose**: Enable any AI agent (low or high capability) to understand, edit, or extend this project without guesswork.

---

## 1. PROJECT IDENTITY

**Product**: E-Logbook Enterprise — an enterprise-grade, high-compliance electronic logbook for medical residents to log surgical/clinical procedures, map them to accreditation milestones, and receive supervisor verifications.

**Monorepo Name**: `elogbook`  
**Package Manager**: `pnpm` (v9+) with workspaces  
**TypeScript**: v6.0 (strict mode)  
**Node**: 20+  

### Core Stack Per Package

| Package | Role | Framework | UI Library | Styling |
|---------|------|-----------|------------|---------|
| `@elogbook/web` | Web dashboard (Next.js 16) | Next.js 16 (App Router) | `@heroui/react` v3.1 | Tailwind CSS v4 + CSS vars |
| `@elogbook/mobile` | Mobile app (Expo 56) | Expo SDK 56 + React Native 0.85 | NativeWind v4 + custom | Tailwind CSS v4 + NativeWind |
| `@elogbook/shared` | Shared types, schemas, components | TypeScript + React | — | design-tokens.config.js |
| `@elogbook/supabase` | Supabase config (empty package) | — | — | — |

---

## 2. MONOREPO DIRECTORY TREE (CRITICAL — ALL PATHS)

```
G:\elogbook\
├── AGENTS.md                           # Points AI to specs/001-premium-mobile-logbook/plan.md
├── PRODUCT.md                          # Product identity document
├── DESIGN.md                           # Visual design system governance
├── opencode.json                       # OpenCode AI config (model: claude-sonnet-4.5 via bynara)
├── package.json                        # Root: scripts for dev:web, dev:mobile, build:web, db:migrate, functions:deploy
├── pnpm-workspace.yaml                 # Workspaces: apps/*, packages/*
├── TODO_MIGRATION.md                   # TODO list for migrating mobile design tokens to shared
│
├── apps/
│   ├── web/                            # Next.js 16 web app
│   │   ├── app/
│   │   │   ├── layout.tsx              # Root layout: fonts (Outfit, Inter, GeistMono), ErrorBoundary, skip-to-content
│   │   │   ├── globals.css             # All CSS custom properties, badge classes, glass-panel classes, motion tokens
│   │   │   ├── page.tsx                # Home page (minimal: just "E-Logbook" heading)
│   │   │   ├── login/                  # Login page
│   │   │   ├── auth/                   # Auth callback handling
│   │   │   ├── api/                    # API routes (proxy, health)
│   │   │   └── (authenticated)/
│   │   │       ├── layout.tsx          # Authenticated layout: getAuthContext, redirect, Suspense
│   │   │       └── [tenant]/           # Dynamic tenant-slug routing
│   │   │           ├── dashboard/
│   │   │           │   └── page.tsx    # Server-side data fetch: cases, goals, residents, stats → DashboardContent
│   │   │           ├── cases/          # Case list + log new case
│   │   │           ├── approvals/      # Approval dashboard
│   │   │           ├── goals/          # Goal tracking
│   │   │           ├── reports/        # Resident performance reports with PDF export
│   │   │           ├── billing/        # SaaS subscription management
│   │   │           └── admin/          # Admin: AI config, payment gateway, overview
│   │   ├── components/                 # 31 React components
│   │   │   ├── DashboardContent.tsx     # Client-side dashboard: KPI rings, recent cases, goals, pending approvals
│   │   │   ├── CaseForm.tsx            # 4-step wizard: Template → Patient Info → Case Details → Review
│   │   │   ├── ApprovalsDashboard.tsx  # Pending cases with KPI counters, urgency, glass-panel detail
│   │   │   ├── ApprovalActions.tsx     # Approve/reject buttons with celebration animation
│   │   │   ├── AIInsightsPanel.tsx     # HeroUI Card with TextArea + Button → invoke ai-insights edge function
│   │   │   ├── SubscriptionPlans.tsx   # Premium plan comparison cards, checkout flow
│   │   │   ├── ProgramOverviewCharts.tsx # Donut + bar charts for director dashboard (FR-013)
│   │   │   ├── ProgressRing.tsx        # Animated SVG circular progress ring (Framer Motion)
│   │   │   ├── TableSkeleton.tsx       # Shimmer loading skeleton for tables
│   │   │   ├── ReadOnlyBanner.tsx      # Subscription lapse banner
│   │   │   ├── SubscriptionStatusProvider.tsx # Context: isReadOnly, daysUntilSuspension
│   │   │   ├── ErrorBoundary.tsx       # React class-based error boundary
│   │   │   ├── ErrorDisplay.tsx        # Error display with retry button
│   │   │   ├── EmptyState.tsx          # Empty state with icon, title, description, optional action
│   │   │   ├── CardSkeleton.tsx        # Loading skeleton card
│   │   │   ├── FormSkeleton.tsx        # Loading skeleton for forms
│   │   │   ├── GoalForm.tsx            # Goal creation form
│   │   │   ├── HelpPopover.tsx         # Tooltip/help popover
│   │   │   ├── MobileNav.tsx           # Mobile navigation component
│   │   │   ├── Sidebar.tsx             # Desktop sidebar navigation
│   │   │   ├── Toast.tsx               # Toast notification system
│   │   │   ├── AIConfigPanel.tsx       # AI provider configuration (admin)
│   │   │   ├── PaymentGatewayPanel.tsx  # Payment gateway configuration (admin)
│   │   │   ├── CompetencyManager.tsx   # Accreditation framework management
│   │   │   ├── TemplateEditor.tsx      # Case template CRUD (director+)
│   │   │   ├── UserManager.tsx         # User/invite management (admin)
│   │   │   ├── ClientProviders.tsx     # Client-side providers wrapper
│   │   │   ├── case-form/             # Case form step sub-components
│   │   │   │   ├── StepIndicator.tsx
│   │   │   │   ├── TemplateStep.tsx
│   │   │   │   ├── PatientInfoStep.tsx
│   │   │   │   ├── CaseDetailsStep.tsx
│   │   │   │   ├── ReviewStep.tsx
│   │   │   │   └── ConfirmDialog.tsx
│   │   │   ├── cases/                 # Case list components
│   │   │   ├── approvals/             # Approval sub-components
│   │   │   └── dashboard/             # Dashboard sub-components
│   │   ├── lib/
│   │   │   └── supabase/
│   │   │       ├── client.ts          # createClient() — singleton browser Supabase client
│   │   │       ├── server.ts          # createServerSupabase() — server component Supabase client
│   │   │       ├── auth.ts            # getAuthContext() — fetches user, profile, tenant, subscription
│   │   │       ├── middleware.ts       # Next.js middleware for auth
│   │   │       ├── admin.ts           # Admin Supabase client (service role)
│   │   │       └── pagination.ts      # Cursor-based pagination helpers
│   │   ├── next.config.js             # Security headers (CSP, X-Frame-Options, etc.)
│   │   ├── tailwind.config.ts         # Maps clinicalTokens to Tailwind theme (web-specific)
│   │   ├── postcss.config.js
│   │   ├── tsconfig.json
│   │   └── .env.local                 # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
│   │
│   └── mobile/                        # Expo SDK 56 mobile app
│       ├── app/
│       │   ├── _layout.tsx            # Root layout: ErrorBoundary, SafeAreaProvider, fonts, Stack navigator
│       │   ├── login.tsx              # Magic link login with email input
│       │   └── (tabs)/                # Bottom tab navigator
│       │       ├── _layout.tsx        # Tab config: role-based tab visibility, Ionicons
│       │       ├── index.tsx          # Dashboard: stats cards, goal progress rings, sync status
│       │       ├── log-case.tsx       # Case logging: template grid (2-col), form, de-identification toggle, offline sync
│       │       ├── my-cases.tsx       # Case list: filter chips, status badges, sync status, conflict banner
│       │       ├── case-detail.tsx    # Case detail view: patient info, fields, approve/reject, edit/resubmit
│       │       ├── approvals.tsx      # Verification dashboard: GlassPanel cards, approve/reject, KPI counters
│       │       ├── ai-insights.tsx    # AI clinical reflection: query input, streaming response, disclaimer, quota
│       │       └── profile.tsx        # Profile: avatar, role, subscription plan, sign out
│       ├── components/
│       │   ├── GlassPanel.tsx         # Native BlurView wrapper for glass-panel effect
│       │   ├── StatusBadge.tsx        # Shared status badge (draft/pending/approved/rejected)
│       │   ├── ProgressRing.tsx       # SVG circular progress ring with glow filter
│       │   └── case-log/
│       │       └── useTemplateLoader.ts # Custom hook for template loading
│       ├── lib/
│       │   ├── supabase.ts            # createClient with SecureStore adapter for auth
│       │   ├── sync.ts                # SyncService: WatermelonDB ↔ Supabase sync, conflict resolution
│       │   ├── haptics.ts             # useHaptics(): submitSuccess, submitError, offlineSave, approvalAction, selection
│       │   ├── notifications.ts       # useCaseNotifications(): polls approval_requests for status changes
│       │   └── db/
│       │       ├── database.ts        # WatermelonDB database singleton (SQLite adapter)
│       │       ├── schema.ts          # WatermelonDB schema v2: case_entries, case_templates, program_goals
│       │       ├── storage.ts         # CRUD helpers: saveDraftCase, getDraftCases, upsertCaseEntry, etc.
│       │       └── models/
│       │           ├── CaseEntry.ts    # WatermelonDB model: @field decorators for all columns
│       │           ├── CaseTemplate.ts # WatermelonDB model: @json for fields/requiredFields
│       │           └── ProgramGoal.ts  # WatermelonDB model: goal progress tracking
│       ├── assets/
│       │   └── fonts/                 # Outfit, Inter, GeistMono TTF files
│       ├── global.css                 # Tailwind theme: backdrop, panel, primary, secondary, font-family classes
│       ├── tailwind.config.js         # Maps clinicalTokens to Tailwind theme (mobile-specific)
│       ├── app.json                   # Expo config
│       ├── metro.config.js
│       ├── babel.config.js
│       ├── postcss.config.mjs
│       └── tsconfig.json
│
├── packages/
│   └── shared/                        # Shared package (workspace dependency)
│       ├── package.json               # main="./src/index.ts", depends on zod
│       ├── tsconfig.json
│       ├── design-tokens.config.js    # CommonJS export for Tailwind configs (clinicalTokens object)
│       └── src/
│           ├── index.ts               # Barrel export: types, schemas, constants, components
│           ├── types/
│           │   ├── database.ts        # ALL TypeScript interfaces: Institution, Tenant, Profile, CaseEntry,
│           │   │                      #   CaseTemplate, TemplateField, ApprovalRequest, AIConfig, AIQueryLog,
│           │   │                      #   SubscriptionPlan, PaymentGatewayConfig, AccreditationFramework,
│           │   │                      #   InstitutionBilling, CaseAttachment, AttachmentSignature, ProgramGoal,
│           │   │                      #   ComplianceConfiguration, and more...
│           │   └── database.server.ts  # Server-only types: AIConfigServer, PaymentGatewayConfigServer
│           │                           #   (with encrypted API keys — NEVER import in client code)
│           ├── schemas/
│           │   ├── cases.ts           # Zod schemas: templateFieldSchema, caseEntrySchema (discriminated union),
│           │   │                      #   accreditationMappingSchema, aiQuerySchema, approvalActionSchema, etc.
│           │   ├── auth.ts            # Zod schemas: profileSchema, inviteUserSchema, complianceConfigSchema
│           │   └── subscriptions.ts   # Zod schemas: subscriptionPlanSchema, paymentGatewayConfigSchema
│           ├── constants/
│           │   ├── design-tokens.ts   # clinicalTokens object (colors, fonts, spacing, radius, shadows, glass, animation)
│           │   │                      #   + clinicalColors, clinicalFonts, animationTokens
│           │   └── animations.ts      # DEFAULT_TRANSITION, SPRING_SLIDE_UP, STAGGER_DELAY, CARD_EXIT_ANIMATION, KPI_COUNT_UP
│           └── components/            # Cross-platform components with .native.tsx / .web.tsx pattern
│               ├── index.ts           # Exports: Panel/GlassPanel/StatusBadge/ProgressRing/ClinicalText (web + native)
│               ├── Panel.web.tsx       # Opaque panel with neutral-darker background, border, padding
│               ├── Panel.native.tsx    # Same but View/TouchableOpacity with clinicalTokens
│               ├── GlassPanel.web.tsx  # Glass-panel: backdrop-blur, white/5 bg, border, shadow
│               ├── GlassPanel.native.tsx # Same effect via BlurView from @react-native-community/blur
│               ├── StatusBadge.web.tsx # 5 variants (draft/pending/approved/rejected/deidentified), 2 sizes
│               ├── StatusBadge.native.tsx # Same with View/Text instead of span
│               ├── ProgressRing.web.tsx # Animated SVG progress ring via Framer Motion useMotionValue
│               ├── ProgressRing.native.tsx # Animated SVG via requestAnimationFrame + react-native-svg
│               ├── ClinicalText.web.tsx  # Monospace text for clinical data with clinicalTokens fonts
│               └── ClinicalText.native.tsx # Same for React Native
│
├── supabase/                          # Supabase project configuration
│   ├── config.toml                    # Project ID, DB port, auth URLs, function config
│   ├── seed.sql                       # Seed data: 5 subscription plans + 2 default case templates
│   ├── migrations/                    # 18 migration files (00001–00018)
│   │   ├── 00001_schema.sql           # Core schema: institutions, tenants, profiles, case_templates,
│   │   │                              #   case_entries, case_attachments, approval_requests, audit_logs,
│   │   │                              #   program_goals, goal_progress, subscription_plans, subscriptions,
│   │   │                              #   payments, one_time_purchases, ai_config, resident_ai_toggle,
│   │   │                              #   ai_query_logs, payment_gateway_config
│   │   │                              #   + update_updated_at() trigger function
│   │   ├── 00002_rls_policies.sql     # RLS on ALL 19 tables, helper functions (get_tenant_id, get_user_role),
│   │   │                              #   granular per-role policies for every table
│   │   ├── 00003_triggers.sql         # audit_case_entry (INSERT/UPDATE/DELETE → audit_logs),
│   │   │                              #   auto_approve_individual (individual tenants auto-approved),
│   │   │                              #   recalc_goal_progress (case status changes → goal_progress update),
│   │   │                              #   get_case_stats RPC, write_once_submitted_check,
│   │   │                              #   audit_accreditation_framework
│   │   ├── 00004_auth_triggers.sql    # handle_new_user() — auto-creates tenant + profile on auth signup
│   │   ├── 00005_seed_data.sql        # 5 subscription plans (Free/Individual Premium/Institution Basic/Pro/Enterprise)
│   │   │                              #   + 2 default case templates (Surgery, Radiology)
│   │   ├── 00006_demo_accounts.sql    # Creates demo users: resident/supervisor/director/admin/platform@demo.com
│   │   │                              #   all under "Demo Hospital" institution tenant
│   │   ├── 00007_enterprise_upgrade.sql # De-identification fields, accreditation_frameworks, attachment_signatures,
│   │   │                              #   institution_billing tables, hash_patient_mrn(), calculate_age_at_procedure()
│   │   ├── 00008_premium_mobile_logbook.sql # Compliance fields on tenants, AI safety fields on ai_query_logs
│   │   ├── 00009_concurrent_approval_lock.sql # approve_case() / reject_case() RPCs with SELECT...FOR UPDATE row lock
│   │   ├── 00010_lapsed_tenant_write_guard.sql # Block INSERT for lapsed tenants, trigger block draft→pending
│   │   ├── 00011_critical_schema_fixes.sql # UNIQUE index, CHECK constraints, compound indexes, soft-delete columns,
│   │   │                              #   stripe_price_id, FK fix, enforce_case_status_transition trigger,
│   │   │                              #   hash_patient_mrn() with configurable salt, stripe_event_id
│   │   ├── 00012_rls_security_fixes.sql # Revoke audit_logs INSERT from users, restrict profile INSERT role,
│   │   │                              #   add auth checks to approve_case/reject_case, fix get_case_stats(),
│   │   │                              #   fix lapsed tenant policies, fix handle_new_user() role restriction,
│   │   │                              #   add deleted_at IS NULL to SELECT policies
│   │   ├── 00013_audit_phi_redaction.sql # NEVER log patient_mrn/dob to audit_logs, consent_records table,
│   │   │                              #   enforce_data_retention() function
│   │   ├── 00014_audit_logs_select_policy.sql # Missing SELECT policies on audit_logs for all roles
│   │   ├── 00015_approval_requests_unique_constraint.sql # Fix: index→constraint for ON CONFLICT
│   │   ├── 00016_case_stats_materialized_view.sql # case_stats_mv materialized view, refresh function,
│   │   │                              #   updated get_case_stats() using MV
│   │   ├── 00017_missing_indexes.sql  # Additional performance indexes (resident+status, supervisor+status,
│   │   │                              #   AI quota query, cursor pagination, audit log user lookups)
│   │   └── 00018_ai_response_cache.sql # ai_response_cache table, cleanup function
│   └── functions/                     # 4 Supabase Edge Functions (Deno)
│       ├── _shared/
│       │   └── auth.ts                # authenticate() - JWT validation, tenant/role extraction; corsHeaders(); escapeHtml()
│       ├── ai-insights/
│       │   └── index.ts               # Multi-provider AI (OpenAI/Anthropic/Azure/OpenRouter/Custom), safety guardrails,
│       │                              #   cache layer (memory + DB), SSE streaming, quota/entitlement check,
│       │                              #   query logging with disclaimer/safety tracking
│       ├── generate-pdf/
│       │   └── index.ts               # PDF generation edge function
│       ├── create-checkout/
│       │   └── index.ts               # Stripe/Paddle/LemonSqueezy checkout session creation
│       └── payment-webhook/
│           └── index.ts               # Payment webhook handler for subscription lifecycle
│
├── specs/
│   └── 001-premium-mobile-logbook/    # Active feature spec
│       ├── spec.md                    # 25 functional requirements, 14 success criteria, 6 user stories, edge cases
│       ├── plan.md                    # Implementation plan with constitution checks
│       ├── research.md                # Technical research decisions (HeroUI→NativeWind, GlassPanel, SVG rings, etc.)
│       ├── data-model.md              # Entity changes, state transitions, validation rules
│       ├── quickstart.md              # Validation scenarios (VS-1 through VS-8)
│       ├── tasks.md                   # 80+ implementation tasks grouped by phase
│       ├── checklists/
│       │   ├── requirements.md
│       │   └── ux.md
│       └── contracts/
│           ├── ai-insights.md
│           ├── billing.md
│           └── sync.md
│
├── scripts/
│   ├── load-test.js                   # k6 load test script (SC-014)
│   └── seed-500-residents.sql         # Seed 500 residents for performance testing (SC-012)
│
└── docs/
    └── performance.md                 # Performance validation instructions
```

---

## 3. ARCHITECTURE & DATA FLOW

### 3.1 Authentication Flow

```
[User] → Magic Link (mobile) or Password (web)
       → Supabase Auth (auth.users)
       → on_auth_user_created trigger → handle_new_user()
           → Creates individual tenant (tenants table)
           → Creates profile (profiles table)
           → Sets tenant_id + user_role in JWT app_metadata
       → Demo: 00006 creates institution-linked profiles (deletes auto-created ones)
       → JWT contains: tenant_id, user_role (used by RLS policies)
```

**CRITICAL**: The `handle_new_user()` trigger in 00012 *restricts* self-assignable roles to `resident` and `supervisor` only. Higher roles (`director`, `institution_admin`, `admin`) must be manually assigned by an existing admin. The original 00004 version allowed any role — 00012 fixes this security hole.

### 3.2 Authorization Model (RLS Hierarchy)

```
admin → institution_admin → director → supervisor → resident
(Higher roles inherit lower-role permissions)

- Resident: Own data only (SELECT on own case_entries, own profile)
- Supervisor: Tenant-wide read + approve/reject on case_entries
- Director: Tenant-wide read + manage templates, goals, accreditation frameworks
- Institution Admin: Full tenant management + billing + AI config + payment config
- Admin: Cross-tenant (global) — manage institutions, subscription plans
```

RLS helper functions:
- `get_tenant_id()`: extracts `tenant_id` from JWT `app_metadata`
- `get_user_role()`: extracts `user_role` from JWT `app_metadata`

### 3.3 Case Entry Lifecycle

```
draft ──→ pending ──→ approved
  ↑                     │
  │        ┌────────────┘
  │        ▼
  └── rejected (edits allowed)
```

Transition enforcement via `enforce_case_status_transition()` trigger (00011):
- draft → draft (save), draft → pending (submit)
- pending → approved, pending → rejected
- rejected → draft (resubmit)
- approved → **immutable** (no transitions)

### 3.4 Mobile Offline Sync

```
┌─────────────────┐     ┌────────────────┐     ┌──────────────┐
│  WatermelonDB   │ ←─→ │  SyncService   │ ←─→ │   Supabase   │
│  (SQLite local) │     │  (sync.ts)     │     │  (server)    │
└─────────────────┘     └────────────────┘     └──────────────┘
                              ↓
                    Server-authoritative conflict resolution:
                    - Server updated_at > local → server wins
                    - Local edits preserved as new draft
                    - Conflict notification banner in UI
```

Sync flow:
1. Pull: `pullCases()` → `pullTemplates()` → `pullGoals()` (parallel)
2. Push: `pushCases()` → upload local drafts
3. Handle conflicts: `handleConflicts()` → mark conflicted entries
4. Periodic: 60s interval, on app foreground, on connectivity restore

---

## 4. DATABASE SCHEMA (COMPLETE)

### All 22+ Tables

| # | Table | Purpose | Has RLS | Key Columns |
|---|-------|---------|---------|-------------|
| 1 | `institutions` | Hospital/organization entities | ✅ | id, name, slug, tier |
| 2 | `tenants` | Programs/individual accounts | ✅ | id, institution_id, tenant_type, plan_id, region, compliance_frameworks |
| 3 | `profiles` | User profiles (linked to auth.users) | ✅ | id, tenant_id, user_id, role, specialty, deleted_at |
| 4 | `case_templates` | Specialty-specific form structures | ✅ | id, tenant_id, specialty, name, fields (JSONB), deleted_at |
| 5 | `case_entries` | Core entity — logged procedures | ✅ | id, tenant_id, resident_id, template_id, patient_hash, status, is_deidentified, deleted_at |
| 6 | `case_attachments` | File attachments to cases | ✅ | id, entry_id, file_path |
| 7 | `approval_requests` | Supervisor verification workflow | ✅ | id, entry_id, supervisor_id, status, comment |
| 8 | `audit_logs` | Immutable audit trail | ✅(complex) | id, tenant_id, user_id, action, changes (JSONB) |
| 9 | `program_goals` | Accreditation targets | ✅ | id, tenant_id, director_id, resident_id, title, target_count |
| 10 | `goal_progress` | Computed goal progress | ✅ | id, goal_id, current_count |
| 11 | `subscription_plans` | SaaS pricing tiers | ✅ | id, name, price_monthly, features (JSONB), max_residents |
| 12 | `subscriptions` | Active subscriptions | ✅ | id, tenant_id, plan_id, status (active/canceled/past_due/unpaid/trialing) |
| 13 | `payments` | Payment records | ✅ | id, tenant_id, amount, status, stripe_event_id |
| 14 | `one_time_purchases` | Individual purchases | ✅ | id, resident_id, purchase_type, amount |
| 15 | `ai_config` | AI provider configuration (encrypted) | ✅ | id, tenant_id, provider, model, encrypted_api_key |
| 16 | `resident_ai_toggle` | Per-resident AI enable/disable + quota | ✅ | id, tenant_id, resident_id, enabled, quota_limit |
| 17 | `ai_query_logs` | AI query history + safety tracking | ✅ | id, tenant_id, resident_id, query, disclaimer_rendered, safety_flags |
| 18 | `payment_gateway_config` | Payment provider configuration | ✅ | id, tenant_id, provider, encrypted_secret_key |
| 19 | `accreditation_frameworks` | Milestone frameworks (ACGME, SCFHS, etc.) | ✅ | id, tenant_id, name, milestones (JSONB) |
| 20 | `attachment_signatures` | Verification signatures | ✅ | id, tenant_id, attachment_id, signature_hash |
| 21 | `institution_billing` | Institutional invoices | ✅ | id, tenant_id, billing_period, total_amount |
| 22 | `consent_records` | Patient consent tracking | ✅ | id, tenant_id, user_id, consent_type |
| 23 | `ai_response_cache` | AI response caching | ❌ (service) | id, tenant_id, resident_id, query_hash, response_text |

### ALL RPC Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `update_updated_at()` | 00001 | Generic updated_at trigger |
| `get_tenant_id()` | 00002 | Extract tenant_id from JWT |
| `get_user_role()` | 00002 | Extract role from JWT |
| `audit_case_entry()` | 00003/00013 | Log case mutations to audit_logs (PHI redacted) |
| `auto_approve_individual()` | 00003 | Auto-approve for individual tenants |
| `recalc_goal_progress()` | 00003 | Recalculate goal progress on case status change |
| `get_case_stats()` | 00003/00012/00016 | Aggregate case statistics (uses MV in v3) |
| `write_once_submitted_check()` | 00003 | Block resident edits after submission |
| `audit_accreditation_framework()` | 00003 | Log framework changes |
| `handle_new_user()` | 00004/00012 | Auto-create tenant+profile on signup |
| `hash_patient_mrn()` | 00007/00011 | SHA-256 hash with tenant-specific salt |
| `calculate_age_at_procedure()` | 00007 | Calculate age from DOB at procedure date |
| `approve_case()` | 00009/00012 | Atomic approve with row lock + auth check |
| `reject_case()` | 00009/00012 | Atomic reject with row lock + auth check |
| `block_lapsed_tenant_submit()` | 00010 | Prevent draft→pending for lapsed subscriptions |
| `enforce_case_status_transition()` | 00011 | State machine guard |
| `enforce_data_retention()` | 00013 | Soft-delete expired records |
| `refresh_case_stats_mv()` | 00016 | Refresh materialized view |
| `cleanup_ai_response_cache()` | 00018 | Delete expired cache entries |

### RLS Policy Count

Approximately 80+ RLS policies across all tables. Every table has at minimum a SELECT policy for tenant members. Higher-privilege tables (ai_config, payment_gateway_config) are restricted to admin roles only.

---

## 5. DESIGN SYSTEM (THE COMPLETE TOKEN SET)

### Colors
```typescript
backdrop:    dark: '#060814', light: '#F8FAFC'
primary:     DEFAULT: '#0D9488' (teal), hover: '#14B8A6', glow: 'rgba(13,148,136,0.35)'
secondary:   DEFAULT: '#6366F1' (indigo), hover: '#818CF8', glow: 'rgba(99,102,241,0.35)'
neutral:     light: '#E2E8F0', dark: '#0F172A', darker: '#060814'
success:     DEFAULT: '#059669', glow: 'rgba(16,185,129,0.45)'
warning:     DEFAULT: '#D97706', glow: 'rgba(245,158,11,0.45)'
danger:      DEFAULT: '#DC2626', glow: 'rgba(239,68,68,0.45)'
border:      DEFAULT: 'rgba(99,102,241,0.15)', active: 'rgba(99,102,241,0.4)', glow: 'rgba(99,102,241,0.35)'
text:        primary: '#F1F5F9', secondary: '#CBD5E1', muted: '#94A3B8', onPrimary: '#FFFFFF'
status:      pending: '#FCD34D', approved: '#6EE7B7', rejected: '#FCA5A5'
```

### Fonts
```typescript
heading: 'Outfit, sans-serif'        // Headings only
body:    'Inter, Plus Jakarta Sans, sans-serif'  // Body text
mono:    'Geist Mono, JetBrains Mono, monospace'  // Clinical data (MRN, dates, codes)
```

**CRITICAL**: `ClinicalText` component always uses `fontFamily: clinicalTokens.fonts.mono` — it's meant for clinical data display, not general body text. The component name is misleading.

### Glass Panel (Elevation)
```typescript
glass = {
  blur: 12,
  border: 'rgba(255, 255, 255, 0.05)',
  shadow: '0 8px 32px rgba(6, 8, 20, 0.4)',
}
```

**Design Rule**: `.glass-panel` is ONLY for transient overlays (modals, wizards, dialogs, sheets). Data-dense content (cards, lists, tables) uses `.panel` (opaque, `#0F172A` background). NEVER use glass-panel for data containers.

### Status Badge Variants
| Variant | Text Color | Border | Glow Shadow |
|---------|-----------|--------|-------------|
| draft | `#94A3B8` | `rgba(148,163,184,0.3)` | None |
| pending | `#FCD34D` | `rgba(252,211,77,0.3)` | `0 0 8px rgba(252,211,77,0.4)` |
| approved | `#6EE7B7` | `rgba(16,185,129,0.3)` | `0 0 8px rgba(110,231,183,0.4)` |
| rejected | `#FCA5A5` | `rgba(239,68,68,0.3)` | `0 0 8px rgba(252,165,165,0.4)` |

---

## 6. SHARED COMPONENT PATTERN (.web.tsx / .native.tsx)

The shared package uses platform-specific file extensions:
- `ComponentName.web.tsx` — Web implementation (uses HTML DOM, Framer Motion, CSS)
- `ComponentName.native.tsx` — Native implementation (uses React Native, Reanimated, SVG)

Available shared components:
1. **Panel** — Opaque data container (`#0F172A` bg, border, rounded)
2. **GlassPanel** — Transient overlay (`backdrop-filter: blur(12px)`)
3. **StatusBadge** — 5 variants × 2 sizes with glowing dot indicator
4. **ProgressRing** — Animated SVG circular progress ring
5. **ClinicalText** — Monospace text for clinical data (ALWAYS uses mono font)

---

## 7. KNOWN ISSUES & INCONSISTENCIES

### Critical

1. **`approvals.tsx` (mobile) imports LOCAL GlassPanel, not shared**
   - `apps/mobile/app/(tabs)/approvals.tsx` line 14: `import GlassPanel from '../../components/GlassPanel';`
   - `apps/mobile/app/(tabs)/ai-insights.tsx` line 17: same pattern
   - `apps/mobile/app/(tabs)/profile.tsx` line 5: same pattern
   - But these local components are DUPLICATES of `@elogbook/shared`'s `NativeGlassPanel`
   - TODO_MIGRATION.md lists replacing these with shared imports

2. **`StatusBadge.tsx` mobile — TWO versions exist**
   - `apps/mobile/components/StatusBadge.tsx`: Uses `StyleSheet`, supports 4 status types, `clinicalTokens` theme
   - `packages/shared/src/components/StatusBadge.native.tsx`: More complete, supports 5 types + deidentified, 2 sizes
   - Mobile screens import the LOCAL version (`../../components/StatusBadge`), not the shared one
   - This means mobile badge rendering uses OLDER code with fewer features

3. **`ProgressRing.tsx` mobile — THREE versions exist**
   - `apps/mobile/components/ProgressRing.tsx`: Local, uses `react-native-svg`, NO animation
   - `packages/shared/src/components/ProgressRing.native.tsx`: Animated via requestAnimationFrame, SVG glow filter
   - Both are used inconsistently across screens

4. **`ClinicalText` component uses mono font always**
   - Despite the name suggesting general clinical text, it ALWAYS uses `fontFamily: clinicalTokens.fonts.mono`
   - It's intended ONLY for clinical identifiers, not body/label text

### Medium

5. **`dashboard/page.tsx` (web) — empty state has no proper loading**
   - The server component fetches all data then passes to `DashboardContent`
   - No Suspense boundaries for individual sections

6. **`sync.ts` — `getLastSyncTimestamp`/`setLastSyncTimestamp` use milliseconds**
   - `storage.ts` line 221-228: stores as `parseInt(val, 10)` — number of ms since epoch
   - But `sync.ts` line 94: `new Date(lastSync).toISOString()` — Date constructor takes ms correctly
   - However line 111: `await setLastSyncTimestamp(now)` where `now = Date.now()` — consistent

7. **`upsertCaseEntry` in `storage.ts` — date handling is fragile**
   - Lines 128, 148: `new Date(Number(serverData.updated_at))` — but `updated_at` from Supabase is an ISO string, not a number
   - This will produce `Invalid Date` for ISO string inputs
   - Similar issue in `upsertTemplate` and `upsertProgramGoal`

8. **Mobile `log-case.tsx` — validation error silently swallowed**
   - Line 131: `const firstError = validation.error.issues[0];` — assigned but never used/shown to user
   - Function returns early with no user feedback

### Low

9. **`approvals.tsx` (mobile) — `loadProfileAndApprovals` is both a `useCallback` AND used in `useEffect` dependency**
   - Correct pattern, but the function creates its own closure over `supabase` — no issues, but worth noting

10. **`ai-insights.tsx` (mobile) — `aiQuerySchema` validation always fails**
    - Lines 86-91: passes `resident_id: ''` and `tenant_id: ''` — these are UUID fields with `.uuid()` validation
    - Validation will ALWAYS fail for empty strings, but the function continues anyway
    - The validation is essentially dead code here

11. **`subscriptionPlans` table — Enterprise price is $0.00 (not a pricing error)**
    - It's a "Contact Us" plan — enterprise pricing is handled outside the app

12. **`case_templates` — global templates use magic UUID `00000000-0000-0000-0000-000000000000`**
    - This is the "Global Templates" tenant — hardcoded in both web and mobile
    - Not documented anywhere outside seed files

---

## 8. SCRIPT COMMANDS

```bash
pnpm dev:web                          # Start Next.js on :3000
pnpm dev:mobile                       # Start Expo dev server
pnpm build:web                        # Production build
pnpm --filter @elogbook/web typecheck # TypeScript check (web)
pnpm --filter @elogbook/mobile typecheck # TypeScript check (mobile)
pnpm --filter @elogbook/shared typecheck # TypeScript check (shared)
pnpm --filter @elogbook/web lint      # ESLint (web)
pnpm --filter @elogbook/mobile lint   # ESLint (mobile)
supabase start                        # Local Supabase
supabase db reset                     # Apply all migrations + seed
supabase db push                      # Push migrations to remote
supabase functions deploy <name>      # Deploy edge function
```

**IMPORTANT**: There is NO `@elogbook/supabase` typecheck — `package.json` just has `"typecheck": "echo ok"`. Shared package typecheck must pass before web/mobile typecheck succeeds.

---

## 9. ENVIRONMENT VARIABLES

`.env.local` (root):
```
NEXT_PUBLIC_SUPABASE_URL=<SUPABASE_PROJECT_ID>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Mobile `.env` (if exists):
```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```
Mobile client reads from `expo-constants` Extra config first, falls back to `process.env.EXPO_PUBLIC_*`.

Edge functions additionally need: `SUPABASE_SERVICE_ROLE_KEY` (for admin client).

---

## 10. SECURITY ARCHITECTURE

1. **Database-level** (RLS): Every table has row-level security. Roles extracted from JWT.
2. **Application-level**: Server components verify auth via `getAuthContext()`. Client components respect read-only status from `SubscriptionStatusProvider`.
3. **API functions**: Edge functions authenticate via `authenticate()` helper using JWT Bearer token. Use service_role client for DB access.
4. **PHI protection**: `patient_mrn` and `patient_dob` are NEVER logged to audit_logs (00013). De-identification defaults to true.
5. **Secrets**: API keys stored in `encrypted_api_key`/`encrypted_secret_key` columns. Server-only types (`database.server.ts`) expose these; never import in client code.
6. **Write immutability**: Once a case is `pending`, residents cannot modify it (write_once_submitted_check). Approved cases are permanently immutable.

---

## 11. DEMO ACCOUNTS (from 00006)

| Email | Password | Role |
|-------|----------|------|
| resident@demo.com | password123! | resident |
| supervisor@demo.com | password123! | supervisor |
| director@demo.com | password123! | director |
| admin@demo.com | password123! | institution_admin |
| platform@demo.com | password123! | admin (platform-wide) |

All users belong to tenant "Demo Hospital" (slug: "demo").

---

## 12. FRONTEND ROUTING

### Web (Next.js App Router)
```
/ → Home page (unauthenticated)
/login → Login page
/auth/callback → Auth callback
/{tenant}/dashboard → Authenticated dashboard
/{tenant}/cases → Case list
/{tenant}/cases/new → New case form
/{tenant}/cases/{id} → Case detail
/{tenant}/approvals → Approval dashboard
/{tenant}/goals → Goal tracking
/{tenant}/reports → Resident performance reports
/{tenant}/billing → Subscription management
/{tenant}/admin → Admin (AI config, payment gateway)
/{tenant}/admin/overview → Program director overview (FR-013)
```

### Mobile (Expo Router, Tab-based)
```
/login → Login screen
/(tabs) → Bottom tab navigator
/(tabs)/index → Dashboard (stats + goals)
/(tabs)/log-case → Case logging wizard
/(tabs)/my-cases → Case list with filters
/(tabs)/case-detail → Case detail (hidden from tabs)
/(tabs)/approvals → Verification dashboard
/(tabs)/ai-insights → AI clinical reflection
/(tabs)/profile → Profile + subscription
```

---

## 13. KEY IMPLEMENTATION DETAILS

### Web Dashboard (`DashboardContent.tsx`)
- KPI rings are inline SVG (not the shared `ProgressRing` component)
- Goals use `ProgressBar` sub-component (horizontal bar), NOT progress rings
- Status badges use CSS classes (`.badge-draft`, etc.) from `globals.css`, NOT the shared `StatusBadge`
- Data is fetched server-side in `dashboard/page.tsx` and passed as props

### Web Case Form (`CaseForm.tsx`)
- 4-step wizard with `AnimatePresence` for slide transitions
- Uses `@heroui/react` `Button` component
- Keyboard shortcuts: Enter = next/submit, Escape = back
- Supports save draft and accreditation framework integration
- `StepIndicator`, `TemplateStep`, `PatientInfoStep`, `CaseDetailsStep`, `ReviewStep`, `ConfirmDialog` are separate components in `components/case-form/`

### Web Approvals (`ApprovalsDashboard.tsx`)
- `SimpleCounter` animation using `requestAnimationFrame` (not Framer Motion)
- Groups pending cases with resident profile, template, field values
- Uses `ApprovalActions` sub-component for approve/reject with celebration
- Fetches approval_requests separately and merges with case entries
- Empty state, error state with retry, KPI counter row

### Mobile Sync Service (`sync.ts`)
- Singleton `SyncService` class with status listeners
- Pull: cases → templates → goals (parallel Promise.all)
- Push: local drafts → Supabase (with mutex to prevent concurrent pushes)
- Conflict detection via `updated_at` comparison + 409 status code
- Exponential backoff on error (30s, 60s, 120s, 300s)
- Periodic sync every 60s, triggers on app foreground + connectivity restore
- NetInfo listener + AppState listener for lifecycle management

---

## 14. AI Edge Function (`ai-insights/index.ts`)

**Multi-provider architecture**: OpenAI, Anthropic, Azure, OpenRouter, Custom

**Safety guardrails**:
- Regex patterns block: diagnosis, prescription, prognosis language
- Mandatory disclaimer appended to every response
- `safety_flags` array in response and logged to `ai_query_logs`
- De-identification check: refuses to process if `is_deidentified !== true`

**Caching**: Two-layer cache:
1. In-memory `Map` (5-minute TTL)
2. `ai_response_cache` database table

**Streaming**: SSE (Server-Sent Events) support via `ReadableStream` with `text/event-stream` content type

**Quota**: Checks `resident_ai_toggle` for enabled status and quota limit. Returns 429 if quota exceeded.

---

## 15. WORK IN PROGRESS / TODO

From `TODO_MIGRATION.md`:
- All 8 mobile screens need design token migration (use `clinicalTokens.colors.*` instead of hardcoded hex)
- 3 mobile components need to switch from local to shared (`@elogbook/shared`)
- Color/font replacements: `#060814` → `clinicalTokens.colors.backdrop.dark`, etc.
- Mobile screens currently use many hardcoded Tailwind classes like `bg-slate-900` instead of `bg-panel`

Referenced spec `001-premium-mobile-logbook` is the ACTIVE feature branch. All recent work targets this spec.

---

## 16. HOW TO CREATE NEW FEATURES

1. Create spec in `specs/{id}-feature-name/` with `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `tasks.md`
2. Add AGENTS.md entry pointing to `plan.md` 
3. Follow constitution gates in plan: Security & Compliance → Clinical Precision UX → Schema-Driven Development → Offline-First Mobile → Role-Based Multi-Tenancy
4. Implement migrations first (supabase/migrations/)
5. Update shared types/schemas in `@elogbook/shared`
6. Build web components → mobile components (or vice versa, maintaining parity)
7. Wire offline sync if applicable
8. Verify with `pnpm --filter <package> typecheck` and `pnpm --filter <package> lint`
