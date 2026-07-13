-- ============================================================================
-- 00056_audit_triggers_and_cron.sql
--
-- Phase 2 batch: P2.9, P2.14
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P2.9 — Audit triggers for previously-uncovered tables
-- ---------------------------------------------------------------------------
-- Generic audit function (P2.9).
CREATE OR REPLACE FUNCTION public.audit_table_change()
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
  v_excluded TEXT[];
BEGIN
  IF TG_NARGS > 0 THEN v_excluded := string_to_array(TG_ARGV[0], ', '); ELSE v_excluded := '{}'::TEXT[]; END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
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

-- Create audit triggers for uncovered tables (one per table via DO block)
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_profiles ON public.profiles; CREATE TRIGGER trg_audit_profiles AFTER INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('password'); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_tenants ON public.tenants; CREATE TRIGGER trg_audit_tenants AFTER INSERT OR UPDATE OR DELETE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_subscriptions ON public.subscriptions; CREATE TRIGGER trg_audit_subscriptions AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_payments ON public.payments; CREATE TRIGGER trg_audit_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_consent_records ON public.consent_records; CREATE TRIGGER trg_audit_consent_records AFTER INSERT OR UPDATE OR DELETE ON public.consent_records FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_approval_requests ON public.approval_requests; CREATE TRIGGER trg_audit_approval_requests AFTER INSERT OR UPDATE OR DELETE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_case_attachments ON public.case_attachments; CREATE TRIGGER trg_audit_case_attachments AFTER INSERT OR UPDATE OR DELETE ON public.case_attachments FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_stripe_events ON public.stripe_events; CREATE TRIGGER trg_audit_stripe_events AFTER INSERT OR UPDATE OR DELETE ON public.stripe_events FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_resident_ai_toggle ON public.resident_ai_toggle; CREATE TRIGGER trg_audit_resident_ai_toggle AFTER INSERT OR UPDATE OR DELETE ON public.resident_ai_toggle FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_institutions ON public.institutions; CREATE TRIGGER trg_audit_institutions AFTER INSERT OR UPDATE OR DELETE ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_case_templates ON public.case_templates; CREATE TRIGGER trg_audit_case_templates AFTER INSERT OR UPDATE OR DELETE ON public.case_templates FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('encrypted_api_key, api_key_enc'); EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_audit_program_goals ON public.program_goals; CREATE TRIGGER trg_audit_program_goals AFTER INSERT OR UPDATE OR DELETE ON public.program_goals FOR EACH ROW EXECUTE FUNCTION public.audit_table_change(''); EXCEPTION WHEN undefined_table THEN NULL; END $$;

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
      $cron$SELECT enforce_data_retention()$cron$
    );

    -- Schedule AI response cache cleanup (every 6 hours).
    PERFORM cron.schedule(
      'cleanup-ai-response-cache',
      '0 */6 * * *',
      $cron$SELECT cleanup_ai_response_cache()$cron$
    );

    RAISE NOTICE 'pg_cron jobs scheduled';
  ELSE
    RAISE NOTICE 'pg_cron not installed; schedule jobs manually per docs/operations.md';
  END IF;
END $$;
