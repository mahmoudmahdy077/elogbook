# E-Logbook Enterprise

> Enterprise-grade electronic logbook for medical residents: log surgical / clinical procedures, map them to accreditation milestones, and receive supervisor verifications — across web and mobile, online and offline.

> **Status:** Enterprise transformation in progress. See [`ENTERPRISE_TRANSFORMATION_PLAN.md`](./ENTERPRISE_TRANSFORMATION_PLAN.md) for the full plan and progress.

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

## Security

For vulnerability reports, see [`SECURITY.md`](./SECURITY.md).

This codebase handles Protected Health Information (PHI). All patient data — including `patient_mrn`, `patient_dob`, and `field_values` — is governed by HIPAA, GDPR, SCFHS, GMC, and other regional regulations. See `docs/compliance/` for compliance artifacts.

## License

See [`LICENSE`](./LICENSE). (Default: MIT — adjust for the actual product licensing.)

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). All PRs must pass typecheck, lint, tests, and the security/audit gates in CI.
