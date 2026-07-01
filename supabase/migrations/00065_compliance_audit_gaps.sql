-- ============================================================================
-- 00065_compliance_audit_gaps.sql
--
-- Phase 7 — closes HIGH-priority audit gaps discovered during compliance
-- audit: requires re-running `supabase db reset` to take effect on a fresh
-- schema; triggers written idempotently so safe to apply against running DB.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add DELETE to accreditation_frameworks trigger
--    The original trigger (00003) only fires on INSERT/UPDATE; the function
--    (00020) already handles DELETE after our fix, but the trigger itself
--    must be recreated to fire on DELETE.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_accreditation_framework ON accreditation_frameworks;

CREATE TRIGGER trg_audit_accreditation_framework
  AFTER INSERT OR UPDATE OR DELETE ON accreditation_frameworks
  FOR EACH ROW EXECUTE FUNCTION audit_accreditation_framework();

-- ---------------------------------------------------------------------------
-- 2. Add audit triggers for case_templates and program_goals
--    These tables were not included in the 00056 audit trigger loop and
--    therefore have zero audit coverage.  We use the same generic
--    audit_table_change function created in 00056.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_excluded_cols TEXT[] := ARRAY['password', 'encrypted_api_key', 'encrypted_secret_key', 'encrypted_webhook_secret', 'api_key_enc', 'secret_key_enc', 'webhook_secret_enc'];
  v_col_list TEXT;
  v_table TEXT;
  v_tables TEXT[] := ARRAY['case_templates', 'program_goals'];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
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

-- ---------------------------------------------------------------------------
-- 3. Add audit logging to enforce_data_retention()
--    The nightly purge of case entries via data-retention policy was
--    running silently with no audit trail.  Now each purge batch writes
--    a single audit_logs row recording the cutoff date and count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_data_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_retention_years INT;
  v_cutoff_date DATE;
  v_purged_count INT;
  v_tenant_record RECORD;
BEGIN
  FOR v_tenant_record IN
    SELECT tenant_id, retention_years
    FROM data_retention_policies
    WHERE is_active = true
  LOOP
    v_retention_years := v_tenant_record.retention_years;
    v_cutoff_date := CURRENT_DATE - (v_retention_years * INTERVAL '1 year');

    WITH deleted AS (
      UPDATE case_entries
      SET deleted_at = NOW()
      WHERE tenant_id = v_tenant_record.tenant_id
        AND case_date < v_cutoff_date
        AND deleted_at IS NULL
      RETURNING id
    )
    SELECT COUNT(*) INTO v_purged_count FROM deleted;

    IF v_purged_count > 0 THEN
      INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
      VALUES (
        v_tenant_record.tenant_id,
        '00000000-0000-0000-0000-000000000000',
        'data_retention_purge',
        'case_entries',
        NULL,
        jsonb_build_object(
          'cutoff_date', v_cutoff_date,
          'retention_years', v_retention_years,
          'purged_count', v_purged_count
        )
      );
    END IF;
  END LOOP;
END;
$$;
