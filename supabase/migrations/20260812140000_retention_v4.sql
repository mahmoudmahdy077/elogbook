-- 20260812140000_retention_v4.sql
-- S12: v3 iterated a non-existent data_retention_policies table and wrote
-- audit rows with resource_id NULL. v4 works on the real schema:
-- per-tenant retention (tenants.data_retention_days, default 2555),
-- soft-delete case_entries, hard-delete dependent rows, and audit each purge.
-- Executable by service_role only (unchanged privilege from 00055).

CREATE OR REPLACE FUNCTION public.enforce_data_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant RECORD;
  v_cutoff TIMESTAMPTZ;
  v_case_count BIGINT;
  v_query_count BIGINT;
  v_consent_count BIGINT;
  v_attach_count BIGINT;
BEGIN
  FOR v_tenant IN
    SELECT id, COALESCE(data_retention_days, 2555) AS retention_days
    FROM public.tenants
    WHERE deleted_at IS NULL
  LOOP
    v_cutoff := now() - make_interval(days => v_tenant.retention_days);

    UPDATE public.case_entries
       SET deleted_at = now()
     WHERE tenant_id = v_tenant.id
       AND deleted_at IS NULL
       AND created_at < v_cutoff;
    GET DIAGNOSTICS v_case_count = ROW_COUNT;

    DELETE FROM public.ai_query_logs
     WHERE tenant_id = v_tenant.id
       AND created_at < v_cutoff;
    GET DIAGNOSTICS v_query_count = ROW_COUNT;

    DELETE FROM public.consent_records
     WHERE tenant_id = v_tenant.id
       AND granted_at < v_cutoff;
    GET DIAGNOSTICS v_consent_count = ROW_COUNT;

    DELETE FROM public.case_attachments
     WHERE tenant_id = v_tenant.id
       AND entry_id IN (
         SELECT id FROM public.case_entries
          WHERE tenant_id = v_tenant.id
            AND deleted_at IS NOT NULL
            AND deleted_at < v_cutoff
       );
    GET DIAGNOSTICS v_attach_count = ROW_COUNT;

    DELETE FROM public.ai_response_cache
     WHERE tenant_id = v_tenant.id
       AND expires_at < now();

    IF v_case_count > 0 OR v_query_count > 0 OR v_consent_count > 0 OR v_attach_count > 0 THEN
      INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
      VALUES (
        v_tenant.id,
        NULL,
        'data_retention_purge',
        'retention_purge',
        v_tenant.id,
        jsonb_build_object(
          'cutoff', v_cutoff,
          'cases_soft_deleted', v_case_count,
          'ai_query_logs_deleted', v_query_count,
          'consent_records_deleted', v_consent_count,
          'attachments_deleted', v_attach_count
        )
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_data_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_data_retention() TO service_role;
