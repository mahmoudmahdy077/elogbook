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

### PITR (Point-in-Time Recovery) — P7.6

PITR is enabled at the Supabase project level (Settings → Database → Point
in Time Recovery). The on-disk write-ahead log is retained for 7 days on
the Pro plan, which is comfortably below the 1h RPO target. The presence
of `[db.backups]` in `supabase/config.toml` is a documentation marker —
the actual setting lives in the dashboard and is not controlled by the
CLI.

**Restore via PITR (last-resort, for a corrupted production DB):**

1. Open `https://app.supabase.com/project/<SUPABASE_PROJECT_REF>/database/backups`.
2. Choose the recovery point (timestamp; PITR granularity is seconds).
3. Click "Restore to a new project" — do **not** restore in place. A new
   project gets a fresh ref; production remains untouched until you swap
   the `NEXT_PUBLIC_SUPABASE_URL` to the restored ref.
4. Validate the restored project: `supabase db dump --project-ref <NEW_REF>`
   and diff against the most recent pre-restore dump.
5. Cut over: update the `PRODUCTION` GitHub environment with the new ref +
   service-role key, redeploy web via `cd.yml`, smoke-test login + 3 core
   flows, then decommission the old project.
6. **RTO budget:** 4h. Steps 1–4 are the bulk of that; step 5 must be
   rehearsed quarterly. The DR drill template is at
   `docs/dr-drills/YYYY-MM-DD.md` (create as needed).

### Preview branches (per-PR databases) — P7.6

Supabase Branching spawns an isolated, copy-on-write Postgres instance
per pull request. Every CI run that needs a real database (RLS tests,
Playwright e2e) gets its own ref with the migrations applied and a
seeded tenant.

**Enable once (project-level):** Settings → Branches → toggle "Enable
Branching". GitHub integration is configured under Settings → Integrations
→ GitHub.

**Day-to-day usage:**

```bash
# Link a local checkout to a PR's preview branch
supabase link --branch <BRANCH_NAME>

# Or, in CI, the `supabase/setup-cli@v1` action + env vars
# SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF achieve the same.
```

The GitHub Action `.github/workflows/preview-branch.yml` (created in
Phase 8) is the consumer; the `[branches] enabled = true` marker in
`supabase/config.toml` documents the intent at code-review time.

## Secrets

Stored in GitHub Actions environment secrets (per environment):
- `PRODUCTION` environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_ENCRYPTION_KEY`, `SENTRY_DSN`.

Rotation schedule: Supabase service role key quarterly, Stripe keys annually, APP_ENCRYPTION_KEY semi-annually (with key versioning — see P7.7).
