# E-Logbook Enterprise

> Enterprise-grade electronic logbook for medical residents: log surgical / clinical procedures, map them to accreditation milestones, and receive supervisor verifications — across web and mobile, online and offline.

> **Status:** Enterprise transformation in progress. Canonical implementation roadmap: [`ELOGBOOK_MASTER_UPGRADE_PLAN.md`](./ELOGBOOK_MASTER_UPGRADE_PLAN.md). Product context: [`PRODUCT.md`](./PRODUCT.md). Historical plans (`ENTERPRISE_TRANSFORMATION_PLAN.md`, `PRODUCTION_UPGRADE_PLAN.md`, `docs/` backlogs) are retained as evidence; do not execute conflicting instructions from them in parallel.

## Quickstart

```bash
# 1. Install dependencies (Node 20.11+ via .nvmrc, pnpm 9.15+)
nvm use            # or: nvm install
pnpm install --frozen-lockfile

# 2. Set up environment (copy and fill in)
cp .env.example .env.local
# (see docs/env-reference.md for the full list)

# 3. Start local Supabase
supabase start
supabase db reset   # applies migrations + seeds

# 4. Start the web app
pnpm dev:web        # http://localhost:3000

# 5. Start the mobile app (separate shell)
pnpm dev:mobile     # opens Expo Dev Tools
```

## Architecture

```
elogbook/                          # pnpm monorepo
├── apps/
│   ├── web/                       # Next.js 16 (App Router, RSC, TS strict)
│   └── mobile/                    # Expo SDK 56 (React Native 0.85, WatermelonDB)
├── packages/
│   ├── shared/                    # Cross-platform types, Zod schemas, components
│   └── supabase/                  # Supabase config helper package
├── supabase/                      # Postgres migrations + Edge Functions
│   ├── migrations/               # 50+ versioned SQL files
│   ├── functions/                 # Deno edge functions (ai-insights, payment, pdf)
│   ├── tests/                     # pgTAP-style RLS + RPC regression tests
│   └── seed.sql                   # Subscription plans + default case templates
├── docs/                          # Operational docs (Sentry, MFA, deploy, etc.)
├── specs/                         # Feature specs (SpecKit format)
│   ├── 001-premium-mobile-logbook/   # Active feature
│   └── _archive/                     # Superseded plans
├── scripts/                       # load-test, seed, helpers
└── ENTERPRISE_TRANSFORMATION_PLAN.md   # Canonical transformation plan
```

**Stack:** TypeScript (strict), Next.js 16, Expo 56, Supabase (Postgres 17 + Edge Functions), WatermelonDB, Zod, Sentry, Playwright, Vitest, pnpm 9, Turborepo, GitHub Actions.

**Key features:**
- 📋 Multi-step case entry wizard (template → patient → details → review)
- 🔒 Row-level security on every tenant-scoped table (FORCE RLS)
- 🏥 Multi-tenant (institution / individual) with role hierarchy: admin → institution_admin → director → supervisor → resident
- 📱 Offline-first mobile (SQLCipher-at-rest, WatermelonDB + Supabase sync)
- 🤖 AI clinical reflection (multi-provider: OpenAI, Anthropic, Azure, OpenRouter, custom) with safety guardrails
- ✅ Supervisor approval workflow (FOR UPDATE row-locked)
- 📊 Program director overview, goal tracking, PDF export
- 💳 Stripe / Paddle / LemonSqueezy billing with tenant-scoped webhook routing

## Demo accounts (local dev only — gated by `app.enable_demo_migrations`)

| Email | Password | Role |
|-------|----------|------|
| `resident@demo.com` | `password123!` | resident |
| `supervisor@demo.com` | `password123!` | supervisor |
| `director@demo.com` | `password123!` | director |
| `admin@demo.com` | `password123!` | institution_admin |
| `platform@demo.com` | `password123!` | admin (platform-wide) |

## Scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev:web` | Start Next.js dev server on :3000 |
| `pnpm dev:mobile` | Start Expo dev server |
| `pnpm build:web` | Production web build |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint:all` | ESLint on web + mobile |
| `pnpm test` | Run Vitest across all packages |
| `pnpm test:coverage` | Run with coverage report |
| `pnpm turbo typecheck` | Cached, incremental typecheck (Turborepo) |
| `supabase db reset` | Apply all migrations + seed |
| `supabase db push` | Push migrations to remote project |
| `supabase functions deploy <name>` | Deploy an edge function |

## Design Token System

The visual language is defined once in [`packages/shared/src/constants/design-tokens.ts`](./packages/shared/src/constants/design-tokens.ts) as `clinicalTokens` and consumed by both platforms — web via CSS variables/`STATUS.css` (see `apps/web/app/globals.css`), native via the shared `StatusBadge` / GlassPanel components from `@elogbook/shared`. Do not hardcode colors; addition of new colors means adding a token.

**Palette (Apple Health-inspired, light default):**

| Token | Value | Use |
|-------|-------|-----|
| `colors.backdrop.dark` | `#F2F2F7` | App background (iOS systemGray6) |
| `colors.primary` | `#007AFF` (hover `#0066D6`) | Actions, links, accents |
| `colors.text.primary/secondary/muted` | `#000000` / `#3C3C43` / `#6D6D73` | Type hierarchy (all WCAG AA on light surfaces) |
| `colors.status.text.*` | success `#186B2E`, warning `#8F4200`, danger `#C20012`, draft `#48484A` | **AA-safe darkened Apple hues for small text/badges** — raw iOS hues (#34C759 etc.) fail 4.5:1 on white; raw brights remain correct on dark |
| `colors.status.bg/border.*` | darker-hued `rgba(..., 0.08/0.20)` | Status pill tints sized so contrast holds on the tinted bg, not just white |
| `colors.deidentified` | `#4442C9` | De-identified tag (raw #5856D6 failed AA on glass) |
| `glass.bg` / `glass.blur` | `rgba(255,255,255,0.72)` / 20 | Frosted-glass panels |
| `shadows.*` | `none` | Zero shadows — clinical, flat aesthetic by design |

Rules: every color change must pass WCAG AA worst-case (text on white, `#F2F2F7`, and status tint backgrounds); spacing (`4/8/16/24/32/48`) and radius (`8/10/14/18`) scale is shared; mobile Tailwind `@theme` in `apps/mobile/global.css` is synced to these values — update both sides together.

Full contrast-audit rationale is inline in the token comments and `apps/web/app/globals.css`.

## Security

For vulnerability reports, see [`SECURITY.md`](./SECURITY.md).

This codebase handles Protected Health Information (PHI). All patient data — including `patient_mrn`, `patient_dob`, and `field_values` — is governed by HIPAA, GDPR, SCFHS, GMC, and other regional regulations. See `docs/compliance/` for compliance artifacts.

## License

See [`LICENSE`](./LICENSE). (Default: MIT — adjust for the actual product licensing.)

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). All PRs must pass typecheck, lint, tests, and the security/audit gates in CI.
