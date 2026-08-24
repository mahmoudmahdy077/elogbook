-- 20260812110000_harden_tenant_rpcs.sql
-- S2/D4/D5: tenant-scoped RPCs must validate the caller against the target
-- tenant instead of trusting parameters. EXECUTE privileges: default PUBLIC
-- grants are revoked; only authenticated and service_role may call.

-- ── get_dashboard_data ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_data(
  p_tenant_id    UUID,
  p_resident_id  UUID,
  p_role         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role            TEXT := get_user_role();
  v_stats           JSONB;
  v_recent_cases    JSONB;
  v_resident_counts JSONB;
  v_pending_approvals BIGINT;
  v_total_residents BIGINT;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant dashboard access denied'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'draft',    COALESCE(count(*) FILTER (WHERE status = 'draft'),    0),
    'pending',  COALESCE(count(*) FILTER (WHERE status = 'pending'),  0),
    'approved', COALESCE(count(*) FILTER (WHERE status = 'approved'), 0),
    'rejected', COALESCE(count(*) FILTER (WHERE status = 'rejected'), 0)
  ) INTO v_stats
  FROM public.case_entries
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND (v_role != 'resident' OR (v_role = 'resident' AND resident_id = p_resident_id));

  SELECT jsonb_agg(sub ORDER BY sub.created_at DESC)
  INTO v_recent_cases
  FROM (
    SELECT
      ce.id,
      ce.case_date,
      ce.status,
      ct.name      AS template_name,
      ct.specialty AS template_specialty
    FROM public.case_entries ce
    JOIN public.case_templates ct ON ct.id = ce.template_id
    WHERE ce.tenant_id = p_tenant_id
      AND ce.deleted_at IS NULL
      AND (v_role != 'resident' OR (v_role = 'resident' AND ce.resident_id = p_resident_id))
    ORDER BY ce.created_at DESC
    LIMIT 5
  ) sub;

  IF v_recent_cases IS NULL THEN
    v_recent_cases := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.resident_id), '[]'::jsonb)
  INTO v_resident_counts
  FROM (
    SELECT resident_id,
           count(*)                       AS total,
           count(*) FILTER (WHERE status = 'approved') AS approved
    FROM public.case_entries
    WHERE tenant_id = p_tenant_id
      AND deleted_at IS NULL
    GROUP BY resident_id
  ) t;

  SELECT COUNT(*) INTO v_pending_approvals
  FROM public.case_entries
  WHERE tenant_id = p_tenant_id
    AND status = 'pending'
    AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_total_residents
  FROM public.profiles
  WHERE tenant_id = p_tenant_id
    AND role = 'resident';

  RETURN jsonb_build_object(
    'stats',              v_stats,
    'recent_cases',       v_recent_cases,
    'resident_counts',    v_resident_counts,
    'pending_approvals',  v_pending_approvals,
    'total_residents',    v_total_residents
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  TO authenticated, service_role;

-- ── get_template_usage_counts ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_template_usage_counts(UUID, UUID);

CREATE FUNCTION public.get_template_usage_counts(p_tenant_id UUID, p_resident_id UUID)
RETURNS TABLE(template_id UUID, personal_count BIGINT, tenant_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant template usage access denied'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT ct.id, COUNT(ce) FILTER (WHERE ce.resident_id = p_resident_id), COUNT(ce)
  FROM public.case_templates ct
  LEFT JOIN public.case_entries ce ON ce.template_id = ct.id AND ce.deleted_at IS NULL
  WHERE ct.tenant_id IN (p_tenant_id, '00000000-0000-0000-0000-000000000000')
  GROUP BY ct.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_template_usage_counts(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_template_usage_counts(UUID, UUID)
  TO authenticated, service_role;

-- ── check_case_quota ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_case_quota(p_tenant_id UUID)
RETURNS TABLE(allowed BOOLEAN, current_count BIGINT, max_cases INT, plan_slug TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_plan_id UUID; v_features JSONB;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant quota access denied'
        USING ERRCODE = '42501';
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
