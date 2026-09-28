-- ============================================================================
-- 20260923000001_legacy_rpc_and_grant_containment.sql
--
-- Task 4: intentionally retire the legacy dynamic offline-sync RPCs.
-- This is a breaking change: current app/mobile callers use
-- public.submit_case_operation(text, text, uuid, jsonb), not these RPCs.
--
-- The REVOKEs are guarded so this migration is safe when either function has
-- already been removed. The drops are explicit, exact-signature, forward-only
-- operations with no CASCADE; unrelated RPCs are not touched.
-- Covered by: supabase/tests/p1_17_legacy_rpc_containment.sql
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.sync_pull_changes(text,uuid,timestamptz,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.sync_pull_changes(text, uuid, timestamptz, integer)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;

  IF to_regprocedure('public.sync_push_batch(text,jsonb)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.sync_push_batch(text, jsonb)
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.sync_pull_changes(text, uuid, timestamptz, integer) RESTRICT;
DROP FUNCTION IF EXISTS public.sync_push_batch(text, jsonb) RESTRICT;
