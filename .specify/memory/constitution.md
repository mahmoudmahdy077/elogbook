<!--
  Sync Impact Report
  ==================
  Version change: 1.0.0 → 1.0.1 (PATCH: Sync Impact Report correction)
  Modified sections: None (no principle or governance changes)
  Added sections: None
  Removed sections: None
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ aligned (Constitution Check section ready)
    - .specify/templates/spec-template.md ✅ aligned (requirements/edge cases structure)
    - .specify/templates/tasks-template.md ✅ aligned (phase structure matches workflow)
    - .specify/templates/constitution-template.md (source template, no update needed)
    - AGENTS.md ✅ aligned (runtime guidance references current plan)
  Follow-up TODOs: None
-->

# E-Logbook Enterprise Constitution

## Core Principles

### I. Security & Compliance First (NON-NEGOTIABLE)

Patient data protection is the highest priority. Every layer of the system MUST enforce
privacy and auditability.

- **De-identification by default**: `case_entries.is_deidentified` MUST default to `true`.
  PII fields (`patient_mrn`, `patient_dob`) MUST be nullable and conditionally validated.
- **Write-once immutability**: Once a case entry transitions from `draft` to `pending`,
  residents MUST NOT modify it. Enforced at database level via triggers AND at application
  level via RLS policies.
- **Row-Level Security**: Every database table MUST have RLS enabled. Queries MUST be scoped
  by `tenant_id` via JWT claims. No bypass via service_role in application code.
- **Audit trails**: All mutations to `case_entries`, `accreditation_frameworks`, and AI
  queries MUST be logged to `audit_logs` with user identity, timestamp, and change diffs.
- **Encryption at rest**: API keys (`ai_config.encrypted_api_key`, payment gateway secrets)
  MUST be stored encrypted. Transport MUST use HTTPS exclusively.

**Rationale**: HIPAA and GDPR compliance is non-optional for a clinical logbook handling
patient MRNs, DOBs, and procedure records. A single privacy breach invalidates the product.

### II. Clinical Precision UX

The UI MUST reflect the clinical domain—premium, fluid, and precise—never generic.

- **Design system compliance**: All UI MUST follow `DESIGN.md` tokens (colors, typography,
  elevation, motion). No ad-hoc colors, fonts, or border styles.
- **Anti-pattern enforcement**: NEVER use flat `#000` or `#121212` backgrounds, nested
  hard-bordered cards, purple-to-blue gradients, Inter for headings, or gray text on
  colored backgrounds.
- **Accessibility**: WCAG AAA contrast ratios (minimum 7:1 for body text). All interactive
  elements MUST have focus indicators, ARIA labels, and keyboard navigation support.
- **Motion discipline**: Transitions MUST use `200ms cubic-bezier(0.4, 0, 0.2, 1)`.
  Modals/sheets MUST use spring-like slide-up. No sudden appearances.

**Rationale**: Medical professionals judge clinical software credibility by its visual
precision. Generic SaaS styling erodes trust. The design system is a differentiator.

### III. Schema-Driven Development

All data shapes MUST be defined as single-source-of-truth Zod schemas in `@elogbook/shared`
before being consumed by web, mobile, or backend.

- **Shared types first**: Database types (`database.ts`), validation schemas (`cases.ts`,
  `auth.ts`, `subscriptions.ts`), and constants MUST live in `@elogbook/shared`.
- **Zod as contract**: Every form submission, API request, and database mutation MUST
  validate against the shared Zod schema. `caseEntrySchema` (discriminated union on
  `is_deidentified`) is the canonical case shape.
- **No duplicate types**: Web and mobile MUST import types from `@elogbook/shared`, not
  redefine them. TypeScript interfaces mirror Supabase table shapes exactly.
- **Migration-schema consistency**: Every database migration MUST have a corresponding
  TypeScript type update in `@elogbook/shared` before the migration is considered complete.

**Rationale**: Shared schemas prevent drift between the three consumers (web, mobile,
Supabase functions). Discriminated unions enforce de-identification safety at compile time.

### IV. Offline-First Mobile

The mobile app MUST function without network connectivity in clinical environments.

- **Local database**: WatermelonDB (`@nozbe/watermelondb`) with SQLite adapter serves as the
  primary data store. Supabase is the sync target, not the source of truth on mobile.
- **Sync engine**: `SyncService` MUST monitor connectivity, push local drafts when online,
  pull template updates, and resolve conflicts with clear error states.
- **Draft persistence**: Failed submissions MUST save to AsyncStorage as draft cases. No
  case data is lost due to network failure.
- **Templates offline**: Case templates MUST be cached locally via WatermelonDB. Template
  selection MUST work without network access.

**Rationale**: Residents log procedures from lead-lined ORs and radiology wards where
connectivity is often absent. A logbook that fails offline is unusable in practice.

### V. Role-Based Multi-Tenancy

Data isolation and access control MUST be enforced at the database, application, and
UI layers using tenant-scoped JWT claims and a strict role hierarchy.

- **Tenant isolation**: Every query MUST filter by `tenant_id` extracted from
  `auth.jwt() -> 'app_metadata'`. Users in tenant A MUST NOT access data in tenant B.
- **Role hierarchy**: `resident < supervisor < director < institution_admin < admin`.
  Higher roles inherit lower-role permissions. JWT claims carry `tenant_id` and `user_role`.
- **Auto-provisioning**: On first signup, the `on_auth_user_created` trigger MUST create an
  individual tenant, profile, and JWT metadata automatically.
- **UI gating**: Navigation links, page access, and dashboard content MUST be conditional on
  the authenticated user's role. Server-side guards in layouts MUST redirect unauthorized
  access.

**Rationale**: The system serves both individual residents and institutional programs. Role
escalation and tenant boundaries prevent cross-contamination of sensitive case data.

## Technical Standards

### Technology Stack

| Layer | Technology | Constraint |
|-------|-----------|------------|
| **Web** | Next.js 16 (App Router) | Server Components for data fetching, Client Components for interactivity |
| **Mobile** | Expo SDK 56 + React Native | Expo Router for file-based routing, NativeWind for styling |
| **Backend** | Supabase (PostgreSQL 15) | All business logic in database triggers + Edge Functions (Deno) |
| **Validation** | Zod v4 | All schemas in `@elogbook/shared`, consumed by all packages |
| **Styling** | Tailwind CSS v4 + NativeWind v4 | Design tokens from `DESIGN.md`, no inline style objects |
| **Animation** | Framer Motion (web), Reanimated (mobile) | Purposeful motion only; respect `prefers-reduced-motion` |
| **Auth** | Supabase Auth (Magic Link + Password) | Session managed via `@supabase/ssr` cookies (web), AsyncStorage (mobile) |
| **Local DB** | WatermelonDB + SQLite (mobile only) | Schema defined in `apps/mobile/lib/db/schema.ts` |
| **Payments** | Stripe (primary), Paddle/LemonSqueezy (optional) | Webhook processing via Supabase Edge Functions |
| **AI** | OpenAI / Anthropic / Azure / OpenRouter | Configurable per tenant via `ai_config` table |

### Database Rules

- **Migrations**: Sequential numbered SQL files in `supabase/migrations/`. Never modify
  already-applied migrations; always create new ones.
- **RLS**: Enable on every table. Use `get_tenant_id()` and `get_user_role()` helper
  functions for all policies.
- **Triggers**: Business logic in `BEFORE`/`AFTER` triggers, not application code. Audit
  triggers MUST fire on all sensitive tables.
- **Seeds**: Demo data in `seed.sql` for local development only. Production seeds in
  numbered migration files.

### Font & Design Token Rules

- **Headings**: `Outfit` (never Inter for headings)
- **Body**: `Inter` or `Plus Jakarta Sans`
- **Clinical data** (MRNs, codes, dates): `Geist Mono` or `JetBrains Mono`
- **Colors**: Primary teal `#0D9488`, secondary indigo `#6366F1`, backdrop `#060814` (dark)
- **Panels**: `.panel` for data containers, `.glass-panel` ONLY for modals/dialogs/sheets

## Development Workflow

### Agent Coding Standards

All AI agents and developers working on this codebase MUST follow the Karpathy + ECC recipe:

1. **Build from scratch**: Understand underlying mechanics before adding libraries or
   abstractions. Trace logic down to query planners, JWT metadata, and SQLite schemas.
2. **Overfit a single case**: Mock the simplest path first. Verify success before
   generalizing.
3. **Incremental delivery**: Database Schema → Zod Model → API/Function → UI Component.
   Compile after each step. Never write multi-layer code in one pass.
4. **Severe critic review**: Review code line-by-line as if written at 2 AM. Check for
   implicit types, privacy leaks, offline database compatibility, and clean variable names.
5. **Immutability**: Always create new copies. Never mutate parameters or state in place.
6. **File size**: Keep files under 400 lines typical, 800 lines absolute maximum. Extract
   logical units into separate files.
7. **Error handling**: Never swallow errors. Log detailed server-side context, map to
   user-friendly messages on UI boundaries.

### Quality Gates (Mandatory)

Before declaring any task complete, the following MUST pass:

```bash
# TypeScript verification
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/mobile typecheck
pnpm --filter @elogbook/shared typecheck

# Linter verification
pnpm --filter @elogbook/web lint
pnpm --filter @elogbook/mobile lint

# If migrations changed
supabase db reset
```

### Code Review Standards

- Every change affecting `case_entries`, `profiles`, or `auth` MUST be reviewed for
  privacy implications.
- RLS policy changes MUST be verified with `supabase test db`.
- UI changes MUST reference `DESIGN.md` and `PRODUCT.md` and include before/after
  screenshots in dark mode.

## Governance

### Amendment Process

1. Propose changes via pull request to `.specify/memory/constitution.md`.
2. Changes require approval from the project owner.
3. All amendments MUST include a migration plan if they affect database schema, RLS
   policies, or shared types.
4. The Sync Impact Report at the top of this file MUST be updated with version bump
   rationale and affected templates.

### Versioning Policy

- **MAJOR**: Backward-incompatible governance or principle removals/redefinitions.
- **MINOR**: New principle added, section materially expanded, or new constraint introduced.
- **PATCH**: Clarifications, wording fixes, typo corrections, non-semantic refinements.

### Compliance Review

- All PRs and feature branches MUST pass the Constitution Check gates defined in the
  plan template before merge.
- Quarterly review of RLS policies, audit trail completeness, and encryption posture MUST
  be conducted.
- The `DESIGN.md` anti-pattern list MUST be enforced in all UI code reviews.
- Runtime development guidance lives in `AGENTS.md` and the current plan document.

**Version**: 1.0.1 | **Ratified**: 2026-06-11 | **Last Amended**: 2026-06-15
