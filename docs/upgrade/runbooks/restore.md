# Runbook: Restore (data-loss decision, not a button)

Audience: platform operator at AAL2. Restoring discards all writes since
the recovery point — this is a deliberate decision with a named owner,
never an automatic step.

> Status: MANUAL procedure over T07-corrected primitives (pipefail dumps,
> ON_ERROR_STOP restores, integrity gates, retention floor). Encrypted
> off-host backup, escrow, and drill-measured RPO/RTO arrive with the
> manager-owned flow (T07-full/T27 drills).

## 1. Choose the recovery point

- List sets, newest verified first; confirm manifest + gzip integrity.
- Record: set id, timestamp, what will be lost, owner approval.

## 2. Fence writers first

Stop the app (and any sync/import jobs) BEFORE touching the database.
A restore under live writers is corruption, not recovery.

## 3. Restore (isolated target for rehearsal; live target only in maintenance)

```bash
gunzip -c <set>/database.sql.gz | psql -v ON_ERROR_STOP=1 <db>
# Restore object bytes + configuration recorded in the manifest.
```

## 4. Reconcile before enabling traffic

Re-apply post-backup revocations: operator suspensions, tenant
suspensions, data-mode restrictions, deletion holds. A restore must
never silently re-enable a revoked admin or an identifiable-data
permission. Invalidate sessions where appropriate.

## 5. Verify and re-enable

Readiness 200, login, tenant isolation spot checks, attachment reads,
audit tail. Then traffic. Record RTO achieved (target ≤4h pending
drills) and file the drill report.
