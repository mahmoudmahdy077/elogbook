# Backup & Restore Drill (P3.4)

## Automated Backup

Supabase provides automated daily backups with PITR for Pro plan and above.
- Daily full database backup
- PITR window: configurable (default 7 days)
- Retention: 7 days for daily backups

## Quarterly Restore Drill

1. Create a new Supabase project (staging clone target)
2. Run `supabase db dump --linked` on production to capture schema
3. Run `supabase db push --db-url <new-project-db-url>` to apply schema
4. Verify row counts match between old and new project
5. Run RLS isolation tests against restored data
6. Verify audit log integrity
7. Document RTO/RPO achieved

## On-Demand Backup

```bash
# Schema-only backup
supabase db dump --linked --schema-only > backup/schema-$(date +%Y%m%d).sql

# Data backup (excludes auth schema)
supabase db dump --linked --data-only --exclude auth > backup/data-$(date +%Y%m%d).sql

# Full backup
supabase db dump --linked > backup/full-$(date +%Y%m%d).sql
```

## Verification

After any restore:
1. `supabase db query "SELECT count(*) FROM pg_stat_user_tables"` — all tables present
2. Run `node scripts/lint-migrations.mjs` — migration integrity
3. Run Supabase SQL tests — functional verification
4. Smoke test: create tenant, login, submit case
5. Verify webhook/billing events are queued for replay if needed
