-- Force RLS on all tenant-scoped tables
-- This prevents table owners from bypassing RLS policies

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
    'ai_response_cache'
  ];
  v_applied INT := 0;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    -- Skip if table doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE relname = v_table
        AND relnamespace = 'public'::regnamespace
    ) THEN
      CONTINUE;
    END IF;

    -- Force RLS (idempotent)
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    v_applied := v_applied + 1;
  END LOOP;

  RAISE NOTICE 'FORCE RLS applied to % tables', v_applied;
END $$;