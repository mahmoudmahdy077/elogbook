-- ============================================================================
-- 20260907000001_drop_debug_artifacts.sql (T05)
--
-- Final-schema cleanup: temporary swarm diagnostics from 2026-08-25 left
-- callable SECURITY DEFINER functions and a debug table in the schema.
-- The earlier drop (20260825070000) predates the migrations that recreated
-- them, so they persist in fresh installs. None are referenced by
-- application code, Edge Functions, or the SQL test inventory (verified by
-- tree search 2026-09-07). Idempotent; history is never rewritten.
-- ============================================================================

DROP FUNCTION IF EXISTS public.debug_exp_tombstone();
DROP FUNCTION IF EXISTS public.debug_policies_full();
DROP FUNCTION IF EXISTS public.dbg_cap_deleted();
DROP TABLE IF EXISTS public._swarm_debug_results;
