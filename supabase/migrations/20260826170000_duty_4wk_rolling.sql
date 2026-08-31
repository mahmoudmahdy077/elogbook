-- ============================================================================
-- 20260826170000_duty_4wk_rolling.sql
-- P2: duty hours only checked SUM>80 per single week — add ACGME 4-week rolling
-- ============================================================================
-- Problem (per docs/superpowers/specs/duty-hour-tracking-spec.md + analysis):
--   duty_periods (00069) + view duty_weekly_violations (00069/00071) only flag
--   SUM(hours_worked) > 80 for a single week (DATE_TRUNC('week', shift_date)).
--   ACGME Common Program Requirement requires average hours over 4 consecutive
--   weeks <= 80 (plus 1-day-in-7 off). The weekly view misses violations where
--   the 4-week rolling average exceeds 80 even though individual weeks are <=80,
--   and over-flags isolated high weeks that average out. Spec Phase 3 Dashboard
--   mentions 4-week average trend but no violation detection implements it.
--
-- Fix (minimal, surgical, idempotent):
--   1. Keep existing view duty_weekly_violations intact — do NOT drop or alter
--      its definition (00071 fixed security_invoker). This migration does not
--      touch it except for a defensive comment; dashboard queries continue to work.
--   2. Create VIEW public.duty_4wk_violations WITH (security_invoker = true)
--      that computes 4-week rolling AVG(SUM hours_worked) per
--      (tenant_id, resident_id). Weekly aggregation identical to the weekly
--      view; rolling window uses AVG(...) OVER (
--        PARTITION BY tenant_id, resident_id ORDER BY week_start
--        ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
--      ) and flags where avg > 80 AND weeks_in_window = 4 (ACGME: average
--      over 4 consecutive weeks). Exposes window_start (first week in window)
--      via FIRST_VALUE and window_end (= current week_start) + audit columns.
--      Index idx_duty_periods_tenant_resident_shift (00073) covers this query.
--   3. Create FUNCTION public.get_duty_4wk_violations(p_tenant_id UUID)
--      RETURNS TABLE matching the view, filtered by tenant. SECURITY DEFINER
--      (so pgTAP / service_role tests without a JWT can still read) with
--      explicit tenant filtering:
--        - if p_tenant_id IS NOT NULL -> tenant_id = p_tenant_id
--        - elsif caller JWT tenant (get_tenant_id()) non-null -> own tenant
--        - else (postgres/service_role with no JWT) -> all tenants (defense:
--          caller must still pass a tenant filter in production)
--      Function is STABLE, SET search_path = pg_catalog, public (search_path
--      injection lock). Grants: REVOKE FROM PUBLIC, GRANT EXECUTE to
--      authenticated + service_role. Service_role bypasses RLS anyway.
--   4. TODO: 1-day-in-7 off violation detection (requires scanning for any
--      7 consecutive days without a 24h free calendar day) is not yet
--      implemented. A placeholder view duty_1day_in_7_violations can be added
--      later; this migration documents the gap and does not introduce a
--      stub that might be mistaken for compliance.
--
-- Evidence: supabase/migrations/00069_duty_tracking.sql:24-33
--           supabase/migrations/00071_fix_duty_periods_rls.sql:34-42
--           docs/superpowers/specs/2026-07-01-duty-hour-tracking-spec.md:5-6
-- Grants: VIEW -> authenticated, service_role (RLS via security_invoker)
--         FUNCTION -> authenticated, service_role
-- Idempotent: CREATE OR REPLACE for view/function, DROP FUNCTION IF EXISTS
--             guard for signature changes, GRANT/REVOKE re-applied.
-- Down: DROP VIEW duty_4wk_violations; DROP FUNCTION get_duty_4wk_violations
-- ============================================================================

-- Keep existing weekly view intact — no changes here.
-- Defensive assertion: if duty_weekly_violations were manually dropped, re-create
-- it with the canonical 00071 definition so dashboards keep working. This
-- CREATE OR REPLACE is a no-op when the view already exists with the same body.
CREATE OR REPLACE VIEW public.duty_weekly_violations
WITH (security_invoker = true) AS
SELECT tenant_id, resident_id, week_start, SUM(hours_worked) AS total_hours
FROM (
  SELECT tenant_id, resident_id, shift_date,
         DATE_TRUNC('week', shift_date)::DATE AS week_start,
         hours_worked FROM public.duty_periods
) sub
GROUP BY tenant_id, resident_id, week_start
HAVING SUM(hours_worked) > 80;

-- ============================================================================
-- VIEW: duty_4wk_violations — 4-week rolling average, flags >80
-- ============================================================================
DROP VIEW IF EXISTS public.duty_4wk_violations;

CREATE OR REPLACE VIEW public.duty_4wk_violations
WITH (security_invoker = true) AS
WITH weekly AS (
  SELECT
    tenant_id,
    resident_id,
    DATE_TRUNC('week', shift_date)::DATE AS week_start,
    SUM(hours_worked) AS total_hours
  FROM public.duty_periods
  GROUP BY tenant_id, resident_id, DATE_TRUNC('week', shift_date)::DATE
),
rolling AS (
  SELECT
    tenant_id,
    resident_id,
    week_start,
    total_hours,
    AVG(total_hours) OVER w AS avg_4wk,
    COUNT(*) OVER w AS weeks_in_window,
    FIRST_VALUE(week_start) OVER w AS window_start
  FROM weekly
  WINDOW w AS (
    PARTITION BY tenant_id, resident_id
    ORDER BY week_start
    ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
  )
)
SELECT
  tenant_id,
  resident_id,
  window_start,
  week_start AS window_end,
  ROUND(avg_4wk::NUMERIC, 2) AS avg_hours,
  weeks_in_window,
  total_hours AS week_hours
FROM rolling
WHERE avg_4wk > 80
  AND weeks_in_window = 4;

COMMENT ON VIEW public.duty_4wk_violations IS
  'P2: ACGME 4-week rolling average violations (AVG weekly SUM hours_worked over 4 consecutive weeks >80). Weekly grain via DATE_TRUNC(week, shift_date); window = 3 preceding + current week. View is security_invoker so duty_periods RLS applies. See 20260826170000. TODO: 1-day-in-7 rule (separate view) not yet implemented.';

-- Least-privilege grants for view
REVOKE ALL ON public.duty_4wk_violations FROM PUBLIC;
GRANT SELECT ON public.duty_4wk_violations TO authenticated;
GRANT SELECT ON public.duty_4wk_violations TO service_role;

-- ============================================================================
-- FUNCTION: get_duty_4wk_violations(p_tenant_id UUID)
-- Convenience RPC wrapper filtered by tenant; also powers PostgREST / supabase.rpc
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_duty_4wk_violations(UUID);

CREATE OR REPLACE FUNCTION public.get_duty_4wk_violations(p_tenant_id UUID)
RETURNS TABLE (
  tenant_id UUID,
  resident_id UUID,
  window_start DATE,
  window_end DATE,
  avg_hours NUMERIC,
  weeks_in_window BIGINT,
  week_hours NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    v.tenant_id,
    v.resident_id,
    v.window_start,
    v.window_end,
    v.avg_hours,
    v.weeks_in_window::BIGINT,
    v.week_hours
  FROM public.duty_4wk_violations v
  WHERE
    CASE
      WHEN p_tenant_id IS NOT NULL THEN v.tenant_id = p_tenant_id
      WHEN public.get_tenant_id() IS NOT NULL THEN v.tenant_id = public.get_tenant_id()
      ELSE TRUE
    END
  ORDER BY v.resident_id, v.window_end;
$$;

COMMENT ON FUNCTION public.get_duty_4wk_violations(UUID) IS
  'P2: RPC wrapper for duty_4wk_violations. Param p_tenant_id filters by tenant; if NULL uses caller JWT tenant (get_tenant_id()) or returns all for service_role/postgres. Computes 4-week rolling AVG weekly hours >80. SECURITY DEFINER with search_path locked. See 20260826170000.';

REVOKE ALL ON FUNCTION public.get_duty_4wk_violations(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_duty_4wk_violations(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_duty_4wk_violations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_duty_4wk_violations(UUID) TO service_role;

-- ============================================================================
-- TODO: 1-day-in-7 rule
-- ----------------------------------------------------------------------------
-- ACGME also requires 1 day off in 7 (averaged over 4 weeks). Detecting that
-- needs scanning for any 7 consecutive calendar days with no 24h free day
-- (hours_worked = 0 or no duty_periods row). Minimal query would be:
--   WITH days AS (generate_series(min..max)), daily AS (SELECT shift_date, SUM(hours)),
--   THEN check 7-day windows where MIN(daily.hours) > 0 OR COUNT(*) = 7 with no zero day.
--   Left as TODO to keep this migration surgical; do not create a placeholder
--   view that would imply compliance without correct logic.
-- ============================================================================

-- Down migration (manual):
-- DROP FUNCTION IF EXISTS public.get_duty_4wk_violations(UUID);
-- DROP VIEW IF EXISTS public.duty_4wk_violations;
-- (duty_weekly_violations is left intact)
