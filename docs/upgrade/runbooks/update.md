# Runbook: Update (qualified releases only)

Audience: platform operator at AAL2. Never update from `main`, a floating
tag, or `latest`. Every update is a qualified release transition with a
stated rollback class (see `apps/ops` update-plan model).

> Status: MANUAL procedure. The one-action GUI updater (T14-full/T16-full)
> does not exist yet. The in-app synchronous updater is retired (503 by
> default; `ELOGBOOK_LEGACY_UPDATER=true` re-enables it for
> non-production recovery ONLY).

## 1. Review

- Read the release record: target version, compatible sources,
  irreversible migrations, downtime, backup requirement.
- Confirm this installation's version is a compatible source. If not:
  STOP (unsupported transition — guided procedure only).

## 2. Back up and verify (blocking)

```bash
# Verified pre-update backup reflecting the fenced state:
# - database dump passes gzip integrity (T07 gate)
# - manifest present; retention floor holds
```

## 3. Stage, migrate, switch

```bash
git fetch --tags && git checkout <QUALIFIED_TAG>
pnpm install --frozen-lockfile && pnpm build:web
supabase db push               # stops on first error (T08); never mark applied blindly
docker compose up -d --build app
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:3000/api/ready
```

## 4. Verify candidate, then drain

Exercise: login, case create/submit/approve, file access, exports.
Only then route traffic and drain old requests.

## 5. Rollback (decided BEFORE the update, not during)

| Class | Action |
|---|---|
| image-only | Switch proxy back, drain candidate |
| schema-compatible | Same, within the stated window |
| restore-based | Fence writers (maintenance), restore the verified pre-update backup (restore.md), verify readiness |

Incompatible schema rollback is BLOCKED: restore-based recovery only,
with explicit data-loss acceptance (all writes since the recovery point).
