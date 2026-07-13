# Database Migration Policy

## Forward-Only Rule

All schema changes must be **forward-only** (expand/backfill/dual-read/contract). Never rewrite or rename historical migrations against a live project.

## Safe Change Pattern

For every schema change against a live database:

1. **Expand** — Add the new column/table/function without breaking existing code
2. **Backfill** — Populate new columns with data, add not-null constraints after verification
3. **Dual-read** — Deploy application code that reads from both old and new locations
4. **Contract** — Remove the old schema only after verifying no code path uses it

## Migration File Convention

Each migration file name must follow this pattern:

```
<timestamp>_<short-description>.sql
```

Timestamp format: `YYYYMMDDHHMMSS` (e.g., `20260713090000_add_case_status_index.sql`)

**Current state:** The existing migrations use sequential numbering (`00001_` through `00094_`). New migrations must use full timestamps to prevent ordering conflicts.

## Linter Rules

Every migration PR must pass the migration linter (`node scripts/lint-migrations.mjs`):

| Rule | Severity | Description |
|------|----------|-------------|
| Duplicate version | ERROR | Two files with the same version number |
| SECURITY DEFINER without search_path | ERROR | Function may execute with wrong schema resolution |
| Destructive SQL without annotation | WARN | Missing `-- destructive` or `-- requires rollback plan` comment |
| RLS policy without tenant predicate | WARN | Policy may allow cross-tenant access |
| Version gap | WARN | Non-sequential version numbers suggest missing migration files |

## Prohibited Operations on Live Projects

- `DROP TABLE` / `DROP COLUMN` — must use the expand/backfill/contract pattern
- `ALTER COLUMN ... DROP NOT NULL` — requires dual-read application code first
- Renaming a table or column — add new, backfill, dual-read, then remove old
- Rewriting migration file history — create a new migration to fix the problem

## Rollback / Compensation

Every destructive migration must include:
1. A rollback SQL script saved in `supabase/rollbacks/`
2. An annotated comment in the migration file
3. Data-owner approval recorded in the PR

## Audit Trail

Every migration that modifies data must include an audit event in `audit_logs`:
- Actor
- Tenant
- Action (`schema_change`, `data_migration`, `backfill`)
- Resource type and id
- Correlation id (migration filename)
