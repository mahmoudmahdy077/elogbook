# BACKLOG — E-Logbook Enterprise

> Generated: 2026-07-06 | Purpose: Track known issues not yet addressed in the current sprint.

## P1 — Must Fix Before Production

### P1-1: `duty_periods` RLS `WITH CHECK (true)` — Unrestricted Writes

**Source**: Migration `00069_duty_tracking.sql`  
**Severity**: HIGH (data integrity + multi-tenant isolation)

The `duty_periods` table has RLS enabled but the write-side policy is too permissive:

```sql
CREATE POLICY duty_periods_tenant_isolation ON duty_periods
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id))
  WITH CHECK (true);
```

The `WITH CHECK (true)` clause allows **any authenticated user** to INSERT or UPDATE duty periods for any resident regardless of tenant membership. This bypasses tenant isolation for write operations.

**Recommended fix**:
```sql
-- Replace WITH CHECK (true) with a proper tenant check
DROP POLICY IF EXISTS duty_periods_tenant_isolation ON duty_periods;
CREATE POLICY duty_periods_tenant_isolation ON duty_periods
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id))
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE profiles.id = auth.uid()
    )
  );
```

---

### P1-2: `duty_weekly_violations` View — No Explicit Security

**Source**: Migration `00069_duty_tracking.sql`  
**Severity**: MEDIUM (potential data leak through view)

The `duty_weekly_violations` view is created as a plain SQL view without `security_barrier` or `security_invoker` options. In PostgreSQL, views run with the owner's permissions by default and inherit row-level security only when `security_invoker` is set (PostgreSQL 15+). This view aggregates cross-tenant duty hours — if queried without an RLS-aware wrapper, it may leak violation data across tenants.

**Recommended fix**:
```sql
-- Recreate with security_invoker so RLS policies on base tables are enforced
CREATE OR REPLACE VIEW duty_weekly_violations
WITH (security_invoker = true) AS
SELECT ...;
```

---

### P1-3: `faculty_evaluations` RLS — Cross-Tenant Resident Assignment Possible

**Source**: Migration `00070_faculty_evaluations.sql`  
**Severity**: MEDIUM

The RLS policy for `faculty_evaluations` has an asymmetric USING/WITH CHECK:

```sql
CREATE POLICY faculty_evals_tenant_isolation ON faculty_evaluations
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = evaluator_id));
```

The `WITH CHECK` validates `tenant_id` against the **evaluator's** tenant, while `USING` validates against the **resident's** tenant. This means an evaluator can create an evaluation for a resident in a *different* tenant, as long as the `tenant_id` matches the evaluator's tenant — but the `resident_id` FK would point to a foreign tenant's profile. The data row ends up with a mismatched `tenant_id`/`resident_id` pair.

**Recommended fix**: Add an explicit check that the resident belongs to the same tenant as the evaluator, either in the RLS policy or via a CHECK constraint.

---

## P2 — Should Fix

- None currently identified.

---

## Verified — No Issues Found

The following were checked and found to be correct:

| Item | Status |
|------|--------|
| `tenant_webhooks` RLS (00063) | ✅ Has proper admin-scoped RLS |
| `scim_tokens` RLS (00064) | ✅ Has proper admin-only RLS |
| `template_favorites` RLS (00067) | ✅ Has proper user-scoped RLS |
| `approvals.tsx` mobile imports | ✅ Already uses `@elogbook/shared/components/native` |
| `ai-insights.tsx` mobile imports | ✅ Already uses `@elogbook/shared/components/native` |
| `profile.tsx` mobile imports | ✅ Already uses `@elogbook/shared/components/native` |
| Sync timestamps (`storage.ts` / `sync.ts`) | ✅ ms timestamps handled consistently; no off-by-one |
| Dashboard Suspense boundary | ✅ Added in 2026-07-06 fix |
