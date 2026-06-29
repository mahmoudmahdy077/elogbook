-- ============================================================================
-- 00049_force_rls_all_tables.sql
--
-- Phase 0 / P0.6
--
-- Apply ALTER TABLE ... FORCE ROW LEVEL SECURITY to every tenant-scoped
-- table in the public schema.
--
-- Background:
--   ENABLE ROW LEVEL SECURITY only applies RLS to non-owner roles. The
--   table owner (often the migration role or, in some Supabase setups,
--   the service role used by Edge Functions) bypasses RLS by default.
--   This is normally intentional for service work but creates a quiet
--   footgun: a table can appear "RLS protected" while a misconfigured
--   role (or accidental privilege grant to a non-superuser owner) reads
--   every tenant's data.
--
--   FORCE ROW LEVEL SECURITY makes the policies apply even to the
--   table owner. The service role retains an explicit escape hatch
--   via BYPASSRLS at the role level (Postgres default for the
--   supabase service_role), so no functional capability is lost.
--
-- Inventory source: extracted by scanning all migrations for
--   ALTER TABLE <public.X> ENABLE ROW LEVEL SECURITY;
-- No `rate_limits` table exists in this schema, so the P2.5 reference
-- in the plan is a no-op here. If `rate_limits` is added later, append
-- it to this file and to the regression test list.
--
-- Idempotent: every statement is a no-op when FORCE is already set.
-- ============================================================================

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'institutions',
    'tenants',
    'profiles',
    'case_templates',
    'case_entries',
    'case_attachments',
    'approval_requests',
    'audit_logs',
    'program_goals',
    'goal_progress',
    'subscription_plans',
    'subscriptions',
    'payments',
    'one_time_purchases',
    'ai_config',
    'resident_ai_toggle',
    'ai_query_logs',
    'payment_gateway_config',
    'accreditation_frameworks',
    'attachment_signatures',
    'institution_billing',
    'consent_records',
    'ai_response_cache',
    'stripe_events'
  ];
  v_applied INT := 0;
  v_skipped INT := 0;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    -- Skip silently if the table does not exist in this environment
    -- (e.g. a fresh checkout that has not yet run later migrations).
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
       WHERE relname = v_table
         AND relnamespace = 'public'::regnamespace
    ) THEN
      RAISE NOTICE 'skip: %.% does not exist in public schema', 'public', v_table;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Idempotent: only force if not already forced.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
       WHERE relname = v_table
         AND relnamespace = 'public'::regnamespace
         AND relforcerowsecurity = TRUE
    ) THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
      v_applied := v_applied + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'FORCE RLS: applied to % tables, % already forced', v_applied, v_skipped;
END $$;
