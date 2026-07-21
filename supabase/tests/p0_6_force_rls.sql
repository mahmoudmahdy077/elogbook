-- ============================================================================
-- Phase 0 P0.6 Regression Test
-- ============================================================================
-- Verifies that FORCE ROW LEVEL SECURITY is set on every tenant-scoped
-- table. Without FORCE, the table owner (typically the role running
-- migrations / the service role in some configs) bypasses RLS — which
-- is fine for superuser/service work but creates a footgun: if the
-- service role is ever downgraded or the table is re-granted, RLS
-- silently stops applying.
--
-- FORCE makes the policy apply even to the table owner, closing that
-- footgun. The service role can still bypass via explicit BYPASSRLS
-- on the role, not by accident.
--
-- Run with:  psql -f tests/p0_6_force_rls.sql
-- Requires: a running local Supabase (supabase db reset).
-- ============================================================================

DO $$
DECLARE
  v_table TEXT;
  -- Tenant-scoped tables we expect to be forced. This started as a
  -- mirror of 00049_force_rls_all_tables.sql and was extended with
  -- tables created in later migrations.  Migration 00096 now uses a
  -- dynamic query so new tables are caught automatically, but the
  -- test remains as a hard check: every known tenant-scoped table
  -- must have FORCE RLS.
  v_expected TEXT[] := ARRAY[
    'accreditation_frameworks',
    'ai_config',
    'ai_query_logs',
    'ai_response_cache',
    'approval_requests',
    'attachment_signatures',
    'audit_logs',
    'case_attachments',
    'case_entries',
    'case_templates',
    'comments',
    'consent_records',
    'duty_periods',
    'epa_mappings',
    'evaluation_forms',
    'faculty_evaluations',
    'goal_progress',
    'institution_billing',
    'institutions',
    'milestones',
    'notifications',
    'one_time_purchases',
    'payment_gateway_config',
    'payments',
    'profiles',
    'program_goals',
    'resident_ai_toggle',
    'rotations',
    'scholarly_activities',
    'scim_tokens',
    'shifts',
    'stripe_events',
    'subscription_plans',
    'subscriptions',
    'template_favorites',
    'tenant_sso_configs',
    'tenant_webhook_deliveries',
    'tenant_webhooks',
    'tenants',
    'webhook_retry_queue'
  ];
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_relrowsecurity BOOLEAN;
  v_relforcerowsecurity BOOLEAN;
BEGIN
  FOREACH v_table IN ARRAY v_expected LOOP
    SELECT relrowsecurity, relforcerowsecurity
      INTO v_relrowsecurity, v_relforcerowsecurity
      FROM pg_class
     WHERE relname = v_table
       AND relnamespace = 'public'::regnamespace;

    IF v_relrowsecurity IS NULL THEN
      v_missing := array_append(v_missing, v_table || ' (table missing)');
      CONTINUE;
    END IF;

    IF NOT v_relrowsecurity THEN
      v_missing := array_append(v_missing, v_table || ' (RLS not enabled)');
    END IF;

    IF NOT v_relforcerowsecurity THEN
      v_missing := array_append(v_missing, v_table || ' (FORCE not set)');
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'FAIL: tables missing FORCE RLS: %', array_to_string(v_missing, ', ');
  END IF;

  RAISE NOTICE 'PASS: all % tenant-scoped tables have RLS enabled AND forced', array_length(v_expected, 1);
END $$;
