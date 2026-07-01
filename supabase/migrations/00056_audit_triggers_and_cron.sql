-- ============================================================================
-- 00056_audit_triggers_and_cron.sql
--
-- Phase 2 batch: P2.9, P2.14
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P2.9 — Audit triggers for previously-uncovered tables
-- ---------------------------------------------------------------------------
-- Generic audit function: writes OLD/NEW row JSON to audit_logs.
-- Secret columns are stripped (see 00050 for the same pattern).
DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'profiles', 'tenants', 'subscriptions', 'payments',
    'consent_records', 'approval_requests', 'case_attachments',
    'stripe_events', 'resident_ai_toggle',
    'institutions', 'case_templates', 'program_goals'
  ];
  v_excluded_cols TEXT[] := ARRAY['password', 'encrypted_api_key', 'encrypted_secret_key', 'encrypted_webhook_secret', 'api_key_enc', 'secret_key_enc', 'webhook_secret_enc'];
  v_col_list TEXT;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    -- Build a column-removal jsonb - each secret col stripped individually.
    SELECT string_agg(format('- %L', c.column_name), ', ')
      INTO v_col_list
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = v_table
      AND c.column_name = ANY(v_excluded_cols);

    IF v_col_list IS NULL THEN v_col_list := ''; END IF;

    EXECUTE format($f$
      DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I;
      CREATE TRIGGER trg_audit_%I
        AFTER INSERT OR UPDATE OR DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(%L);
    $f$, v_table, v_table, v_table, v_table, v_col_list);
  END LOOP;
END $$;

-- Generic audit function (P2.9).
CREATE OR REPLACE FUNCTION public.audit_table_change(p_excluded_cols TEXT DEFAULT '')
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_action TEXT;
  v_changes jsonb := '{}'::jsonb;
  v_excluded TEXT[] := string_to_array(p_excluded_cols, ', ');
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    -- Capture only the changed columns to keep the audit row small.
    SELECT jsonb_object_agg(key, value)
      INTO v_changes
    FROM jsonb_each(v_new)
    WHERE NOT (key = ANY(v_excluded))
      AND (v_old -> key) IS DISTINCT FROM value;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    COALESCE(NEW.id::text, OLD.id::text),
    jsonb_build_object('new', v_new, 'old', v_old, 'changed', v_changes)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
-- P2.14 — Provision pg_cron; make schedules idempotent; remove stale MV job
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- pg_cron must be available. If not, skip silently (caller's
  -- Supabase project may not have it enabled; the operations runbook
  -- documents the requirement).
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule the stale MV-refresh job from 00039 (MV dropped in 00066).
    PERFORM cron.unschedule('refresh-case-stats-mv');

    -- Schedule retention cleanup (daily at 03:00 UTC).
    PERFORM cron.schedule(
      'enforce-data-retention',
      '0 3 * * *',
      $$SELECT enforce_data_retention()$$
    );

    -- Schedule AI response cache cleanup (every 6 hours).
    PERFORM cron.schedule(
      'cleanup-ai-response-cache',
      '0 */6 * * *',
      $$SELECT cleanup_ai_response_cache()$$
    );

    RAISE NOTICE 'pg_cron jobs scheduled';
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule jobs manually per docs/operations.md';
  END IF;
END $$;
