-- ============================================================================
-- 20260825179999_debug_table_grants.sql
--
-- Fresh-install repair (db-tests/`supabase start` replay fails without it).
-- The 2026-08-25 temporary diagnostic migrations impersonate the
-- `authenticated` role (set_config('role','authenticated')) and then write
-- to public._swarm_debug_results. On a fresh replay that table either does
-- not exist yet or carries no grants for non-owner roles, so every temp
-- migration aborts with 42501 and `supabase start` can never complete.
--
-- This shim runs BEFORE the first temp diagnostic (20260825180000): it
-- ensures the table with the exact historical shape and grants write
-- access to the roles the diagnostics impersonate. Historical migration
-- files are NOT edited (checksums preserved for linked projects); on
-- existing installations this is a harmless no-op. The table itself is
-- dropped again at the end of history (20260907000001).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public._swarm_debug_results(line INT PRIMARY KEY, payload JSONB);
GRANT ALL ON public._swarm_debug_results TO authenticated, anon, service_role;
