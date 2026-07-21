-- supabase/migrations/00096_force_rls_post_00049.sql
-- DB-002: Tables created after 00049_force_rls_all_tables.sql were
-- not in its array literal, so they only got ENABLE ROW LEVEL SECURITY.
-- Without FORCE, the table owner bypasses RLS. This migration applies
-- FORCE to every tenant-scoped table that has RLS enabled but not forced.
-- Idempotent.

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
