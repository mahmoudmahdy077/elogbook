-- ============================================================================
-- 20260825250000_reword_quota_cross_tenant_error.sql
--
-- Security F4 (cosmetic): the cross-tenant guard inside check_case_quota
-- reported 'cross-tenant quota access denied', conflating a policy rejection
-- with a quota event. Full original body preserved (20260812110000, incl.
-- BIGINT count + plan resolution); only the message and HINT change.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_case_quota(p_tenant_id UUID)
RETURNS TABLE(allowed BOOLEAN, current_count BIGINT, max_cases INT, plan_slug TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_plan_id UUID; v_features JSONB;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant access denied'
        USING ERRCODE = '42501',
              HINT = 'Target tenant does not match the caller tenant';
    END IF;
  END IF;

  SELECT plan_id INTO v_plan_id FROM subscriptions WHERE tenant_id = p_tenant_id AND status = 'active' LIMIT 1;
  SELECT features INTO v_features FROM subscription_plans WHERE id = v_plan_id;
  v_features := COALESCE(v_features, '{"max_cases": 20}'::JSONB);
  RETURN QUERY
  SELECT
    CASE WHEN (v_features->>'max_cases')::INT = 0 THEN TRUE
         ELSE (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND deleted_at IS NULL) < (v_features->>'max_cases')::INT
    END,
    (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND deleted_at IS NULL),
    (v_features->>'max_cases')::INT,
    (SELECT slug FROM subscription_plans WHERE id = v_plan_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.check_case_quota(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_case_quota(UUID) TO authenticated, service_role;
