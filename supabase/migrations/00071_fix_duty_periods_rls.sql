-- Migration 00071: Fix RLS security issues in duty_periods and duty_weekly_violations
--
-- Issue 1 (P1.1): duty_periods RLS had WITH CHECK (true) allowing unrestricted writes
-- Fix: DROP the permissive policy and recreate WITH CHECK that validates tenant membership
--
-- Issue 2 (P1.2): duty_weekly_violations view ran with owner permissions (no security_invoker)
-- Fix: Recreate WITH (security_invoker = true) so RLS on duty_periods is enforced for view queries

-- ============================================================
-- Fix 1: duty_periods RLS policy — WITH CHECK bypass
-- ============================================================

DROP POLICY IF EXISTS duty_periods_tenant_isolation ON duty_periods;

CREATE POLICY duty_periods_tenant_isolation ON duty_periods
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id))
  WITH CHECK (
    -- The user performing INSERT/UPDATE must belong to the same tenant
    -- as the duty_period row they are writing. This prevents any authenticated
    -- user from creating/editing duty periods in arbitrary tenants.
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE profiles.id = auth.uid()
    )
  );

-- ============================================================
-- Fix 2: duty_weekly_violations view — security_invoker
-- ============================================================

DROP VIEW IF EXISTS duty_weekly_violations;

CREATE OR REPLACE VIEW duty_weekly_violations
WITH (security_invoker = true) AS
SELECT tenant_id, resident_id, week_start, SUM(hours_worked) AS total_hours
FROM (
  SELECT tenant_id, resident_id, shift_date,
         DATE_TRUNC('week', shift_date)::DATE AS week_start,
         hours_worked FROM duty_periods
) sub
GROUP BY tenant_id, resident_id, week_start
HAVING SUM(hours_worked) > 80;

-- Down migration:
-- DROP VIEW IF EXISTS duty_weekly_violations;
-- CREATE OR REPLACE VIEW duty_weekly_violations AS SELECT ... (original without security_invoker);
-- DROP POLICY IF EXISTS duty_periods_tenant_isolation ON duty_periods;
-- CREATE POLICY duty_periods_tenant_isolation ON duty_periods
--   FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id))
--   WITH CHECK (true);
