# Operations Runbook

## Branch Protection — `main`

The `main` branch is production. It requires:

1. **Pull request with 1+ approval** from a CODEOWNER (see `.github/CODEOWNERS`).
2. **All required status checks pass:**
   - `typecheck` (root) — `pnpm -r typecheck`
   - `lint` (root) — `pnpm -r lint`
   - `test` (root) — `pnpm test`
   - `build` (web) — `pnpm --filter @elogbook/web build`
   - `supabase-check` — `supabase db reset && supabase test db`
   - `codeql` — CodeQL static analysis
   - `coverage` — `pnpm test:coverage` (≥40% per package)
3. **Conversation tasks resolved** on the PR.
4. **Linear history** — squash or rebase, no merge commits.
5. **No force pushes** to `main`.

Configure in GitHub: `Settings → Branches → Branch protection rules → Add rule`.

## Deploy

| Target | Method | Approver |
|--------|--------|----------|
| `main` → production web | Vercel auto-deploy on push (after checks) | CODEOWNER review |
| `main` → production mobile | EAS Build via `cd.yml` (manual) | CODEOWNER review |
| Supabase migrations | `supabase db push` via `cd.yml` | @mahmo |
| Edge functions | `supabase functions deploy <name>` via `cd.yml` | @mahmo |

## Incident Response

1. **Triage** — `kubectl get pods` / Vercel logs / Supabase logs.
2. **Rollback** — `vercel rollback` (web); for DB, see `docs/migration-rollback-plan.md`.
3. **Post-mortem** — write to `docs/postmortems/YYYY-MM-DD-<slug>.md` within 5 business days.

## Health checks

| URL | What it checks |
|-----|----------------|
| `https://app.elogbook.example/api/health` | App + DB reachable |
| `https://<project>.supabase.co/auth/v1/health` | Auth + GoTrue reachable |
| Stripe webhook dashboard | Webhook delivery success rate |

Configure uptime monitoring (UptimeRobot / BetterStack / Pingdom) to alert on Slack `#incidents` if any endpoint returns non-2xx for > 2 minutes.

## On-call

Primary: @mahmo. Secondary: TBD. Rotation: weekly.

## Disaster Recovery (DR)

- **RTO:** 4 hours (SC-013)
- **RPO:** 1 hour (Supabase PITR window)
- **Backups:** Supabase automated daily + PITR enabled
- **Restore procedure:** see `docs/migration-rollback-plan.md` and Supabase dashboard → Settings → Backups
- **DR drill:** quarterly. Record actual RTO/RPO in `docs/dr-drills/`.

## Secrets

Stored in GitHub Actions environment secrets (per environment):
- `PRODUCTION` environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_ENCRYPTION_KEY`, `SENTRY_DSN`.

Rotation schedule: Supabase service role key quarterly, Stripe keys annually, APP_ENCRYPTION_KEY semi-annually (with key versioning — see P7.7).
