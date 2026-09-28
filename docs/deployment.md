# Deployment Guide

> **E-Logbook Enterprise** — Next.js 16 / pnpm monorepo

This document covers all deployment workflows: local development, preview (PR) deployments, production deployment, and rollback procedures.

---

## Table of Contents

- [1. Local Development Setup](#1-local-development-setup)
- [2. Preview Deployments (PR Staging)](#2-preview-deployments-pr-staging)
- [3. Production Deployment](#3-production-deployment)
- [4. Rollback Procedure](#4-rollback-procedure)
- [5. Environment Variables](#5-environment-variables)
- [6. Troubleshooting](#6-troubleshooting)

---

## 1. Local Development Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | >=20.11.0 | Use [nvm](https://github.com/nvm-sh/nvm) to manage versions |
| pnpm | >=9.0.0 <10 | Install: `npm install -g pnpm` or `corepack enable` |
| Supabase CLI | Latest | `brew install supabase/tap/supabase` (macOS) |
| Docker | Latest | Required for Supabase local dev |

### Setup Steps

```bash
# 1. Clone the repository
git clone git@github.com:<org>/elogbook.git
cd elogbook

# 2. Install dependencies
pnpm install

# 3. Copy environment file
cp .env.example .env
# Edit .env with your local Supabase credentials

# 4. Start Supabase locally
supabase start

# 5. Run database migrations
supabase db push

# 6. Start the web dev server
pnpm dev:web
# Opens at http://localhost:3000

# 7. (Optional) Start mobile
pnpm dev:mobile
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev:web` | Start Next.js dev server |
| `pnpm dev:mobile` | Start Expo mobile app |
| `pnpm build:web` | Production build (web) |
| `pnpm test` | Run unit/integration tests |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm lint:all` | Lint all packages |
| `pnpm analyze` | Build with bundle analyzer |

---

## 2. Preview Deployments (PR Staging)

Each pull request automatically gets a **preview deployment** on Vercel.

### How It Works

1. A PR is opened (or new commits are pushed)
2. GitHub Actions triggers the **Deploy Preview** workflow (`.github/workflows/deploy-preview.yml`)
3. The workflow runs:
   - **Type-check** (`pnpm -r typecheck`)
   - **Unit tests** (`pnpm test`)
   - **Deploy** to Vercel preview environment
4. A comment is posted on the PR with the preview URL

### Preview Workflow

```yaml
# .github/workflows/deploy-preview.yml — simplified flow:
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  typecheck → test → deploy-preview
```

### Preview URLs

- Format: `https://<project>-git-<branch>-<org>.vercel.app`
- Auto-updated on every push (new commit → new deployment)
- Old comments are cleaned up; only the latest URL remains

### Preview Environment

Preview deployments use a **separate Supabase staging project** to protect production data:

| Variable | Preview Value |
|----------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `PREVIEW_SUPABASE_URL` (GitHub secret) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `PREVIEW_SUPABASE_ANON_KEY` (GitHub secret) |
| `NEXT_PUBLIC_SITE_URL` | Auto-set by Vercel (`VERCEL_URL`) |
| `NEXT_PUBLIC_SENTRY_ENV` | `preview` |
| Tracing sample rate | 5% (reduced from production) |

### Required GitHub Secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Description |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel API token (generate from Vercel dashboard) |
| `VERCEL_ORG_ID` | Vercel organization ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |
| `PREVIEW_SUPABASE_URL` | (Optional) Staging Supabase project URL |
| `PREVIEW_SUPABASE_ANON_KEY` | (Optional) Staging Supabase anon key |

> **Note:** If `PREVIEW_SUPABASE_URL` / `PREVIEW_SUPABASE_ANON_KEY` are not set, preview deployments fall back to the production Supabase project secrets. **It is strongly recommended to use a separate staging project.**

### Manual Preview Trigger

You can also trigger a preview deployment from the Actions tab:

1. Go to **Actions → Deploy Preview (PR)**
2. Click **Run workflow**
3. Select the branch
4. Click **Run workflow**

---

## 3. Production Deployment

Production has one repository-controlled deployment path: `.github/workflows/release.yml`.
The `cd.yml`, `deploy-web.yml`, and `deploy-mobile.yml` workflows are dispatch-only wrappers that delegate to the reusable release workflow. They contain no independent production deployment commands.

### Protected Release Gate

Dispatch `Protected Release` (or one of the dispatch-only wrappers) with:

- `staging_approved=true` only after the staging checks have been reviewed.
- `staging_url` set to the candidate staging URL.

The canonical workflow then runs the release commit check, frozen dependency installs, typecheck, tests, migration replay, SAST, secret and dependency scans, container and manifest-wide Edge Function scans, SBOM/evidence verification, staging smoke testing, DAST, and the production job. The production job is the only workflow job allowed to deploy web, database, Edge Functions, or mobile artifacts.

Production deployment is not triggered by pushes to `main`. The wrappers do not provide a second deployment path.

### External Environment Protection

GitHub Environment protection for the `production` environment, including required reviewers, wait timers, and branch restrictions, is an external repository/provider configuration. This document and the workflow YAML do not create, verify, or substitute for that approval. An authorized operator must configure and verify the protection and retain the external approval evidence before promotion. A workflow input is not an environment approval.

### Database Migrations

Migrations are applied by the canonical production job only after the migration replay and evidence gates pass. Do not run an independent production database push from a deployment wrapper or workstation.

The production environment URL is: **https://elogbook.app** (configured in Vercel).

---

## 4. Rollback Procedure

### Application Rollback

Use the hosting provider's protected rollback or promotion interface under an externally approved incident runbook. Record the target deployment, approver, reason, and resulting health evidence. Do not run an independent production deployment command from this repository or a developer workstation.

If the rollback requires a code change, merge a reviewed revert and promote that commit through `.github/workflows/release.yml`; a push to `main` does not deploy it.

### Database Rollback

Database changes remain forward-only in the normal release path. A rollback migration must be reviewed, tested against a disposable database, backed up, and applied through an externally controlled database-change process. The canonical release workflow must not be replaced with an ad hoc production database command.

Test rollback procedures in preview/staging first and retain the provider and database evidence with the incident record.

### Rollback Checklist

- [ ] Identify the problematic deployment (git log / Vercel dashboard)
- [ ] Revert Vercel to previous deployment
- [ ] If DB changes were involved, apply rollback migration
- [ ] Verify the site is healthy (monitoring, smoke tests)
- [ ] Notify the team (#incidents channel)
- [ ] Post-mortem: what went wrong and how to prevent it

---

## 5. Environment Variables

### File Reference

| File | Purpose |
|------|---------|
| `.env.example` | Template — copy to `.env` for local dev |
| `.env.preview` | Template — preview/staging env values |
| `.env` | Local development (gitignored) |
| `vercel.json` | Vercel project config (framework, headers, rewrites) |

### CI/CD Secrets

| Secret | Used By | Description |
|--------|---------|-------------|
| `VERCEL_TOKEN` | release, deploy-preview | Vercel API auth |
| `VERCEL_ORG_ID` | release, deploy-preview | Vercel org |
| `VERCEL_PROJECT_ID` | release, deploy-preview | Vercel project |
| `NEXT_PUBLIC_SUPABASE_URL` | release | Production Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | release | Production Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | release | Production service role key |
| `PREVIEW_SUPABASE_URL` | deploy-preview | Staging Supabase URL |
| `PREVIEW_SUPABASE_ANON_KEY` | deploy-preview | Staging Supabase anon key |
| `SENTRY_AUTH_TOKEN` | release | Sentry source map upload |
| `SENTRY_ORG` | release | Sentry org slug |
| `SENTRY_PROJECT` | release | Sentry project slug |

### Vercel Environment Variables

Set these in **Vercel Dashboard → Project → Settings → Environment Variables**:

| Variable | Environments | Source |
|----------|-------------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development | Supabase dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Preview, Development | Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Production only | Supabase dashboard |
| `NEXT_PUBLIC_SENTRY_DSN` | Production, Preview, Development | Sentry dashboard |
| `SENTRY_AUTH_TOKEN` | Production | Sentry dashboard |
| `NEXT_PUBLIC_POSTHOG_KEY` | Production | PostHog dashboard |

---

## 6. Troubleshooting

### Build Failures

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Module not found` | Missing dependency | `pnpm install` |
| `TypeError: Cannot read properties of undefined` | Missing env var | Check `.env` or GitHub secrets |
| `Build failed with code 1` | TS error | Run `pnpm typecheck` locally |
| `Error: ENOENT: no such file or directory` | Monorepo filter issue | Use `pnpm --filter @elogbook/web build` |

### Preview URL Not Posted

1. Check the **Deploy Preview** action run for errors
2. Verify `GITHUB_TOKEN` has `pull-requests: write` permission
3. Check the PR's **Checks** tab for deploy status

### Vercel Auth Errors

```bash
# Verify your Vercel token is valid
vercel whoami --token=$VERCEL_TOKEN

# If invalid, generate a new token:
#   Vercel Dashboard → Settings → Tokens → Create
```

### Preview vs Production Differences

- Preview uses reduced Sentry tracing (5% vs 20%)
- Preview may use a different Supabase project
- PostHog analytics are disabled in preview (unless configured)
- Preview instances scale to zero when idle (cold start on first request)

---

## Deployment Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    GitHub Repository                      │
│                                                            │
│  PR / push validation              workflow_dispatch       │
│       │                                    │                │
│       ▼                                    ▼                │
│  deploy-preview.yml                 cd / deploy-web /       │
│  preview only                       deploy-mobile wrappers   │
│                                          │                 │
│                                          ▼                 │
│                              release.yml protected gate    │
│                                          │                 │
│                                          ▼                 │
│                         evidence + staging + external      │
│                         environment approval                │
│                                          │                 │
│                                          ▼                 │
│                              canonical production job       │
└──────────────────────────────────────────────────────────┘
```

---

> **Last updated:** September 2026
> **Maintainer:** DevOps Team
