-- supabase/migrations/20260826150000_force_rls_remaining.sql
-- RLS-001: Tables created lexicographically after 00096_force_rls_post_00049.sql
-- (custom_plan_features, subscription_changes, tenant_settings,
--  tenant_invites, benchmark_data, procedure_codes, scheduled_backup_log, etc.)
-- were not covered by 00096 because that migration had already run before
-- the 2026* migrations were added. Supabase sorts migrations lexicographically:
-- '00101' < '202607...' so a 00101 prefix would run too early. This file uses
-- a 20260826* timestamp to guarantee it runs after all existing migrations.
-- Applies FORCE ROW LEVEL SECURITY to every table in public that has RLS
-- enabled but not forced. Idempotent. Dynamic (no hard-coded list).

DO $$
DECLARE
  r RECORD;
  v_applied INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'Forced RLS on %', r.relname;
    v_applied := v_applied + 1;
  END LOOP;
  RAISE NOTICE 'FORCE RLS: applied to % tables', v_applied;
END $$;
