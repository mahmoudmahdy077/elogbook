# Environment Inventory

## Systems and Owners

| System | Owner | Purpose | Notes |
|--------|-------|---------|-------|
| GitHub | @mahmoudmahdy077 | Source control, CI/CD, security scanning | `github.com/mahmoudmahdy077/elogbook` |
| Vercel | @mahmoudmahdy077 | Web hosting, preview deployments | Project: `prj_wfSsVg7qWVQkvFGB0Ftmh9ls503K` |
| Supabase | @mahmoudmahdy077 | Database, Auth, Storage, Edge Functions | Project: `nuyedxkzaimlzaetbpaw` (single project for all envs) |
| EAS (Expo) | @mahmoudmahdy077 | Mobile build/submit service | Project: `1c826a68-2477-4df8-8311-ebeba4b46d9e` |

## Canonical Domains

| Environment | Domain | Notes |
|-------------|--------|-------|
| Production | `elogbook.app` | Canonical public domain |
| Preview | Vercel-generated `.vercel.app` | Per PR |
| Local | `http://localhost:3000` | Developer machine |

## Branch Strategy

| Branch | Purpose | Protection |
|--------|---------|------------|
| `main` | Production branch, deployment source | PR required, required checks, no direct push |

> **TODO:** Configure GitHub branch protection for `main`:
> - Require pull request before merging
> - Require code owner review for `supabase/**`
> - Require status checks (CI, security scans)
> - Require linear history
> - No direct force push

## Environment Configuration

### Variables by scope

| Scope | Variables | Source |
|-------|-----------|--------|
| Web public (browser) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SENTRY_*`, `NEXT_PUBLIC_POSTHOG_*` | Vercel env vars / `.env.local` |
| Web server-only | `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `UPSTASH_REDIS_*` | Vercel env vars |
| Mobile public | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SENTRY_DSN` | EAS secrets / `app.json extra` |
| Edge Functions | Deno-compatible env vars for each function | Supabase CLI / dashboard |
| CI | Deployment tokens, test credentials | GitHub secrets |

> **IMPORTANT:** Actual secret values are stored in the password manager / secret manager, not in this file.

### Required setup steps for each environment

1. Create Supabase project
2. Run `supabase db push` with approved migration plan
3. Configure Vercel project with correct env vars
4. Configure EAS project with remote env profile
5. Set GitHub secrets for CI/CD

## Release Checklist Items

- [ ] Environment variables verified per scope
- [ ] Supabase project linked (`supabase link --project-ref <ref>`)
- [ ] Migration ledger matches committed migrations
- [ ] Vercel deployment from `main` succeeds
- [ ] All CI checks pass
- [ ] Service worker does not cache authenticated routes
- [ ] CSP nonce is correctly forwarded
- [ ] Health endpoint responds without exposing internals
- [ ] Sentry and PostHog use reviewed config for environment
