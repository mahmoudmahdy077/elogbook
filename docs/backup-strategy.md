# Database Backup Strategy

> **E-Logbook Enterprise** — Supabase PostgreSQL  
> Document version: 1.0  
> Status: **Approved**

---

## Table of Contents

1. [Overview](#overview)
2. [Backup Frequency](#backup-frequency)
3. [Retention Policy](#retention-policy)
4. [Recovery Objectives](#recovery-objectives)
5. [Backup Scripts](#backup-scripts)
6. [Supabase Managed Backups](#supabase-managed-backups)
7. [Restore Procedure](#restore-procedure)
8. [Monitoring & Alerts](#monitoring--alerts)
9. [Compliance Notes](#compliance-notes)

---

## Overview

This document defines the database backup strategy for the E-Logbook
Enterprise application, which stores Protected Health Information (PHI)
in a Supabase PostgreSQL instance. The strategy uses a **defence-in-depth**
approach combining:

- **Automated daily pg_dump** — SQL-level backup via custom scripts.
- **Supabase managed backups** — Infrastructure-level point-in-time recovery
  (PITR) on Pro/Team plans.
- **Weekly off-site copy** — Periodic transfer of encrypted dumps to a
  separate geographic region or provider for disaster recovery.

---

## Backup Frequency

| Backup Type     | Frequency     | Method                  | Location                    |
|-----------------|---------------|-------------------------|-----------------------------|
| Full snapshot   | Daily at 03:00 UTC | `pg_dump` + gzip  | Local disk (`BACKUP_DIR`)  |
| PITR            | Continuous    | Supabase WAL archiving  | Supabase infrastructure     |
| Off-site copy   | Weekly (Sun)  | rsync / s3cmd / scp     | Off-site object storage     |

**Daily at 03:00 UTC** is chosen to minimise overlap with peak usage hours
for the primary clinical audience and to ensure the dump captures a
consistent state shortly after daily operations conclude.

---

## Retention Policy

| Backup Tier     | Retention Window | Quantity Stored |
|-----------------|------------------|-----------------|
| Daily (local)   | 30 days          | Up to 30 files  |
| Weekly (off-site) | 12 months      | Up to 52 files  |
| PITR (Supabase) | 7 days (Pro) / 14 days (Team) | N/A |

**Cleanup logic** (in `backup-db.sh`):

- Files matching `{prefix}-db-*.sql.gz` and `{prefix}-db-*.sql` older than
  `RETENTION_DAYS` (default: 30) are purged on every backup run.
- Off-site cleanup is handled by the off-site transfer workflow (see
  [Off-site Transfer](#off-site-transfer)).

---

## Recovery Objectives

### RPO (Recovery Point Objective)

**24 hours** — The maximum acceptable data loss in a disaster scenario.

The daily pg_dump at 03:00 UTC produces a fresh recovery point every 24
hours. Combined with Supabase PITR (which provides continuous archiving
with a 2–5 minute lag), the effective RPO is well under 24 hours for most
scenarios.

### RTO (Recovery Time Objective)

**4 hours** — The maximum acceptable time to restore service after a
declared disaster.

The restore procedure (below) is designed to be completable within 4 hours
by an on-call engineer with access to the runbooks.

---

## Backup Scripts

### `scripts/backup-config.sh`

Configuration file sourced by the backup script. Key settings:

| Variable          | Default                  | Description                        |
|-------------------|--------------------------|------------------------------------|
| `BACKUP_DIR`      | `/var/elogbook/backups`  | Local dump destination             |
| `RETENTION_DAYS`  | `30`                     | Max age before automatic cleanup   |
| `DB_URL`          | (from env)               | PostgreSQL connection string       |
| `LOG_FILE`        | `/var/log/elogbook/backup.log` | Backup operation log        |
| `COMPRESS_CMD`    | `gzip`                   | Compression tool                   |
| `PGDUMP_OPTS`     | `--no-owner --no-acl`    | Additional pg_dump flags           |

### `scripts/backup-db.sh`

The main backup script. Idempotent and safe to run from cron.

**Usage:**

```bash
# Full backup
./scripts/backup-db.sh

# Dry-run (preview without writing)
./scripts/backup-db.sh --dry-run

# Override connection string
SUPABASE_DB_URL=postgresql://user:pass@host:5432/db ./scripts/backup-db.sh
```

**What it does:**

1. Sources `backup-config.sh` for defaults.
2. Validates that `DB_URL` and required tools (`pg_dump`, `gzip`) exist.
3. Creates the backup and log directories.
4. Runs `pg_dump $DB_URL $PGDUMP_OPTS -f <file>.sql`.
5. Compresses the dump with `gzip`.
6. Records the resulting file size in the log.
7. Purges files older than `RETENTION_DAYS`.
8. Exits with code 0 on success, 2 on failure.

**Exit codes:**

| Code | Meaning                |
|------|------------------------|
| 0    | Success                |
| 1    | Configuration error    |
| 2    | Backup or compression failure |

---

## Supabase Managed Backups

Supabase projects on Pro/Team plans include:

1. **Daily snapshots** — Retained for 7 days (Pro) or 14 days (Team).
   Accessible from the Supabase Dashboard → Database → Backups.
2. **Point-in-Time Recovery (PITR)** — WAL archiving with 2–5 minute lag.
   Allows restoring to any second within the retention window.

### Scheduled Backup Log (00076_backup_schedule.sql)

Migration `00076` adds an immutable `public.scheduled_backup_log` table and
a `public.log_backup_run()` RPC to record backup outcomes directly in the
database:

```sql
-- Record a successful backup
SELECT public.log_backup_run('success', 1048576, 'Daily backup completed');

-- Record a failure
SELECT public.log_backup_run('failed', NULL, 'pg_dump failed: connection timeout');
```

The table serves as an **append-only audit trail** — records are never
updated or deleted, ensuring compliance with PHI logging requirements.

> **Note:** Automated invocation via `pg_cron` is documented in the migration
> file comments. The `pg_cron` extension must be enabled at the Supabase
> project level (Dashboard → Database → Extensions).

---

## Restore Procedure

### Prerequisites

- PostgreSQL client tools (`pg_dump`, `pg_restore` / `psql`) installed.
- Access to the backup file (local disk or off-site storage).
- Target database (new or existing Supabase project) with `pgcrypto`
  extension available.
- Connection string (`SUPABASE_DB_URL`) for the target database.

### Step-by-Step

#### 1. Identify the backup to restore

```bash
# List available backups
ls -lh /var/elogbook/backups/elogbook-db-*.sql.gz

# Check the backup log for the most recent successful run
tail -50 /var/log/elogbook/backup.log
```

#### 2. Decompress the dump

```bash
gunzip -k /var/elogbook/backups/elogbook-db-20260707T030000Z.sql.gz
```

#### 3. Prepare the target database

```bash
# Create the database (if not exists)
createdb "$TARGET_DB_URL"

# Ensure pgcrypto extension exists
psql "$TARGET_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

#### 4. Restore the dump

```bash
psql "$TARGET_DB_URL" -f /var/elogbook/backups/elogbook-db-20260707T030000Z.sql
```

> **Note:** The dump is a plain SQL file (not custom format). Use `psql` for
> restore. Expect this to take 5–30 minutes depending on database size.

#### 5. Verify the restore

```bash
# Check row counts for core tables
psql "$TARGET_DB_URL" -c "SELECT 'institutions', COUNT(*) FROM institutions"
psql "$TARGET_DB_URL" -c "SELECT 'tenants', COUNT(*) FROM tenants"
psql "$TARGET_DB_URL" -c "SELECT 'profiles', COUNT(*) FROM profiles"
psql "$TARGET_DB_URL" -c "SELECT 'case_entries', COUNT(*) FROM case_entries"

# Verify auth.users were also restored (if applicable)
psql "$TARGET_DB_URL" -c "SELECT COUNT(*) FROM auth.users"
```

#### 6. Update application configuration

```bash
# Point the application to the restored database
export SUPABASE_DB_URL="postgresql://user:pass@restored-host:5432/elogbook"
```

#### 7. Run post-restore checks

- Confirm all application features load without errors.
- Verify that RLS policies are intact (run `supabase db push` if needed).
- Verify audit logs exist and are consistent.
- Check that encryption functions (`pgp_sym_encrypt`/`pgp_sym_decrypt`)
  work with the existing key.

#### 8. Document the restoration

Record the incident in the incident log, including:
- Restoration timestamp
- Backup file used
- Duration of the restore
- Any errors encountered

### Restoring from Off-site Backup

```bash
# Fetch the weekly backup from off-site storage
scp user@offsite-host:/backups/elogbook-weekly-20260706.sql.gz /tmp/
gunzip /tmp/elogbook-weekly-20260706.sql.gz
psql "$TARGET_DB_URL" -f /tmp/elogbook-weekly-20260706.sql
```

### Restoring via Supabase PITR

For granular point-in-time recovery (e.g., recovery from accidental data
deletion):

1. Go to Supabase Dashboard → Database → Backups.
2. Click **Restore** and choose **Point-in-Time**.
3. Select the timestamp to restore to.
4. Confirm — Supabase creates a new project branch with the restored data.
5. Update your application connection string to point to the new branch.

> This approach is faster for small-window disasters but creates a new
> project rather than restoring in-place.

---

## Monitoring & Alerts

### Log-based monitoring

The backup script logs to `LOG_FILE` (default: `/var/log/elogbook/backup.log`)
with ISO-8601 timestamps and severity levels (`INFO`, `WARN`, `ERROR`).

Set up a log shipper (e.g., `tail`, `systemd-journal`, or a SIEM agent) to
watch for `ERROR` lines:

```bash
# Simple cron health check
if grep -q "ERROR" /var/log/elogbook/backup.log; then
  echo "Backup errors detected" | mail -s "E-Logbook Backup Alert" ops@example.com
fi
```

### Database-level tracking

Query the `scheduled_backup_log` table for recent backup status:

```sql
-- Last 10 backup runs
SELECT id, started_at, completed_at, status, size_bytes, notes
  FROM public.scheduled_backup_log
  ORDER BY id DESC
  LIMIT 10;

-- Failed backups in the last 7 days
SELECT COUNT(*)
  FROM public.scheduled_backup_log
  WHERE status = 'failed'
    AND started_at > NOW() - INTERVAL '7 days';
```

### Supabase Dashboard

- **Database → Backups**: View snapshot history and initiate PITR restores.
- **Reports → Database**: Monitor disk usage, connection counts, and
  performance trends.

---

## Compliance Notes

| Requirement        | How Addressed                                                    |
|--------------------|------------------------------------------------------------------|
| PHI data backup    | All dumps include the full database, including encrypted columns. |
| Immutable audit    | `scheduled_backup_log` is append-only (no UPDATE/DELETE triggers). |
| Encryption at rest | Dumps can be encrypted with GPG before off-site transfer.         |
| Retention schedule | Configurable via `RETENTION_DAYS`; 30-day default for daily.      |
| Off-site DR        | Weekly off-site copy ensures geographic redundancy.               |

### Recommended Off-site Transfer (Script)

Create a complementary script `scripts/transfer-offsite.sh`:

```bash
#!/usr/bin/env bash
# Transfer the latest weekly backup to off-site storage.
# Scheduled to run every Sunday after the daily backup.
LATEST=$(ls -t /var/elogbook/backups/elogbook-db-*.sql.gz | head -1)
gpg --recipient ops-key --encrypt "$LATEST"
scp "${LATEST}.gpg" offsite-backup:/backups/elogbook/
```

---

## Appendix: Testing the Backup

### 1. Test script syntax

```bash
bash -n scripts/backup-db.sh && echo "syntax OK"
```

### 2. Test dry-run mode

```bash
SUPABASE_DB_URL=postgresql://test:test@localhost:5432/elogbook \
  ./scripts/backup-db.sh --dry-run
```

### 3. Test restore (in isolated environment)

```bash
# Create a temporary database
createdb elogbook_restore_test

# Restore the latest backup
zcat /var/elogbook/backups/elogbook-db-$(date +%Y%m%d)T*.sql.gz \
  | psql elogbook_restore_test

# Verify
psql elogbook_restore_test -c "\dt"

# Clean up
dropdb elogbook_restore_test
```
