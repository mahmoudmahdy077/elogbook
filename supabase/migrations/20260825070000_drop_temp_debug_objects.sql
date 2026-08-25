-- ============================================================================
-- 20260825070000_drop_temp_debug_objects.sql
--
-- Cleanup for the temporary swarm diagnostics that were applied on 2026-08-25
-- while root-causing the case_entries tombstone 42501:
--   - public.debug_swarm_introspect(TEXT, UUID)  (service_role-only RPC)
--   - public._swarm_debug_results                (empty debug table)
-- NOTE: this migration could not be registered while the CLI bookkeeping
-- INSERT into supabase_migrations.schema_migrations was being denied
-- (platform-side). Apply once `supabase db push` recovers.
-- ============================================================================

DROP FUNCTION IF EXISTS public.debug_swarm_introspect(TEXT, UUID);
DROP TABLE IF EXISTS public._swarm_debug_results;
