-- ============================================================================
-- 20260826160000_benchmark_mv_refresh.sql
-- P2-1: benchmark_mv never refreshed — add nightly refresh
-- ============================================================================
-- Problem: supabase/migrations/00092_benchmarking.sql:15 creates
--   MATERIALIZED VIEW public.benchmark_mv with no refresh mechanism.
--   Docs require nightly refresh for normative percentile API; view was stale
--   indefinitely.
--
-- Fix (minimal, surgical, idempotent):
--   1. Re-assert UNIQUE index required for CONCURRENTLY (00092 already
--      creates idx_benchmark_mv_unique on (specialty, procedure_type) but
--      re-creating IF NOT EXISTS is defensive for older DBs).
--   2. CREATE OR REPLACE FUNCTION public.refresh_benchmark_mv() SECURITY
--      DEFINER — tries REFRESH MATERIALIZED VIEW CONCURRENTLY first (requires
--      unique index), falls back to non-concurrent REFRESH on error (e.g.
--      lock contention / no concurrent support in transaction).
--   3. Schedule pg_cron nightly job 'refresh-benchmark-mv' at 03:30 UTC if
--      pg_cron is installed; otherwise emit NOTICE with manual steps.
--      Also unschedules legacy name 'refresh-benchmarks' (analysis/UPGRADE_PLAN.md:1251)
--      if it exists. Scheduling is idempotent (unschedule-then-schedule).
--   4. Function is SECURITY DEFINER / SET search_path locked; REVOKE from
--      PUBLIC and GRANT only to service_role (internal/cron use). Not granted
--      to anon/authenticated — API reads the MV, only cron/service_role
--      should refresh it. To allow manual admin refresh, grant explicitly:
--        GRANT EXECUTE ON FUNCTION public.refresh_benchmark_mv() TO authenticated;
--
-- Supabase Dashboard fallback if pg_cron extension is not enabled:
--   1. Enable pg_cron:  CREATE EXTENSION IF NOT EXISTS pg_cron;
--      (Supabase Dashboard > Database > Extensions, or SQL editor as superuser)
--   2. Then run:
--        SELECT cron.schedule(
--          'refresh-benchmark-mv',
--          '30 3 * * *',
--          $$SELECT public.refresh_benchmark_mv()$$
--        );
--   Or use Dashboard > Integrations > Cron Jobs (pg_cron UI) with same schedule.
-- ============================================================================

-- 0. Ensure CONCURRENTLY prerequisite — unique index (idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_mv_unique
  ON public.benchmark_mv (specialty, procedure_type);

-- 1. Refresh function (idempotent CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.refresh_benchmark_mv()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Prefer CONCURRENTLY to avoid blocking reads from normative percentile API.
  -- Falls back to blocking REFRESH if CONCURRENTLY fails for any reason.
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.benchmark_mv;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: blocking refresh (always succeeds if MV exists).
    REFRESH MATERIALIZED VIEW public.benchmark_mv;
  END;
END;
$$;

-- Lock down: only service_role / postgres (cron) should invoke.
REVOKE ALL ON FUNCTION public.refresh_benchmark_mv() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_benchmark_mv() TO service_role;

COMMENT ON FUNCTION public.refresh_benchmark_mv() IS
  'P2-1: Nightly refresh for public.benchmark_mv (created in 00092). Tries REFRESH CONCURRENTLY (needs idx_benchmark_mv_unique) then falls back to REFRESH. Scheduled via pg_cron 30 3 * * *; if pg_cron unavailable schedule manually via Dashboard > Cron Jobs.';

-- 2. pg_cron nightly schedule (idempotent, no-op if pg_cron not installed).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove stale/legacy schedules idempotently (ignore if not present).
    BEGIN
      PERFORM cron.unschedule('refresh-benchmark-mv');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('refresh-benchmarks');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    -- Nightly 03:30 UTC (offset from enforce-data-retention @ 03:00).
    PERFORM cron.schedule(
      'refresh-benchmark-mv',
      '30 3 * * *',
      $cron$SELECT public.refresh_benchmark_mv()$cron$
    );
    RAISE NOTICE 'pg_cron job refresh-benchmark-mv scheduled nightly 03:30 UTC';
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule manually: SELECT cron.schedule(''refresh-benchmark-mv'',''30 3 * * *'',''SELECT public.refresh_benchmark_mv()'') after CREATE EXTENSION pg_cron, or use Supabase Dashboard > Cron Jobs';
  END IF;
END $$;
