-- 20260812180000_analytics_rpcs.sql
-- P2/P3: move analytics and report aggregation from the web layer into
-- tenant-validated SQL.

CREATE OR REPLACE FUNCTION public.get_analytics_data(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_from DATE := (CURRENT_DATE - INTERVAL '11 months')::DATE;
  v_monthly_volume JSONB;
  v_specialty JSONB;
  v_monthly_rate JSONB;
  v_workload JSONB;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant analytics access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.month), '[]'::jsonb) INTO v_monthly_volume
  FROM (
    SELECT to_char(m, 'YYYY-MM') AS month, COALESCE(c.cnt, 0) AS count
    FROM generate_series(v_from, CURRENT_DATE, '1 month'::interval) AS m
    LEFT JOIN (
      SELECT date_trunc('month', case_date)::DATE AS month, count(*) AS cnt
      FROM public.case_entries
      WHERE tenant_id = p_tenant_id AND deleted_at IS NULL
      GROUP BY 1
    ) c ON c.month = m::DATE
  ) t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.count DESC), '[]'::jsonb) INTO v_specialty
  FROM (
    SELECT ct.specialty, count(*) AS count
    FROM public.case_entries ce
    JOIN public.case_templates ct ON ct.id = ce.template_id
    WHERE ce.tenant_id = p_tenant_id AND ce.deleted_at IS NULL
    GROUP BY ct.specialty
  ) t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.month), '[]'::jsonb) INTO v_monthly_rate
  FROM (
    SELECT m.month,
           COALESCE(round((a.approved::numeric / NULLIF(a.approved + a.rejected, 0)), 3), 0) AS rate
    FROM (
      SELECT to_char(m, 'YYYY-MM') AS month
      FROM generate_series(v_from, CURRENT_DATE, '1 month'::interval) AS m
    ) m
    LEFT JOIN (
      SELECT to_char(date_trunc('month', case_date)::DATE, 'YYYY-MM') AS month,
             count(*) FILTER (WHERE status = 'approved') AS approved,
             count(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM public.case_entries
      WHERE tenant_id = p_tenant_id AND deleted_at IS NULL
      GROUP BY 1
    ) a ON a.month = m.month
  ) t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.pending DESC), '[]'::jsonb) INTO v_workload
  FROM (
    SELECT ar.supervisor_id,
           count(*) FILTER (WHERE ar.status = 'pending')  AS pending,
           count(*) FILTER (WHERE ar.status = 'approved') AS approved,
           count(*) FILTER (WHERE ar.status = 'rejected') AS rejected,
           COALESCE(p.full_name, 'Unknown') AS supervisor_name
    FROM public.approval_requests ar
    LEFT JOIN public.profiles p ON p.id = ar.supervisor_id
    WHERE ar.tenant_id = p_tenant_id AND ar.supervisor_id IS NOT NULL
    GROUP BY ar.supervisor_id, p.full_name
  ) t;

  RETURN jsonb_build_object(
    'monthly_volume', v_monthly_volume,
    'specialty_breakdown', v_specialty,
    'monthly_approval_rate', v_monthly_rate,
    'supervisor_workload', v_workload
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_analytics_data(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_data(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_report_counts(
  p_tenant_id UUID,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status JSONB;
  v_specialty JSONB;
  v_eval JSONB;
  v_eval_count BIGINT;
  v_from TIMESTAMPTZ := NULLIF(p_date_from, '')::timestamptz;
  v_to TIMESTAMPTZ := NULLIF(p_date_to, '')::timestamptz;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant report access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'draft',    COALESCE(count(*) FILTER (WHERE status = 'draft'),    0),
    'pending',  COALESCE(count(*) FILTER (WHERE status = 'pending'),  0),
    'approved', COALESCE(count(*) FILTER (WHERE status = 'approved'), 0),
    'rejected', COALESCE(count(*) FILTER (WHERE status = 'rejected'), 0)
  ) INTO v_status
  FROM public.case_entries
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND (v_from IS NULL OR created_at >= v_from)
    AND (v_to IS NULL OR created_at <= v_to);

  SELECT COALESCE(jsonb_object_agg(specialty, count), '{}'::jsonb) INTO v_specialty
  FROM (
    SELECT ct.specialty, count(*) AS count
    FROM public.case_entries ce
    JOIN public.case_templates ct ON ct.id = ce.template_id
    WHERE ce.tenant_id = p_tenant_id
      AND ce.deleted_at IS NULL
      AND (v_from IS NULL OR ce.created_at >= v_from)
      AND (v_to IS NULL OR ce.created_at <= v_to)
    GROUP BY ct.specialty
  ) t;

  SELECT jsonb_build_object(
    'clinical', COALESCE(round(avg(clinical_skills)::numeric, 1), 0),
    'prof',     COALESCE(round(avg(professionalism)::numeric, 1), 0),
    'proc',     COALESCE(round(avg(procedures)::numeric, 1), 0)
  ), count(*)
  INTO v_eval, v_eval_count
  FROM public.faculty_evaluations
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'status_counts', v_status,
    'specialty_counts', v_specialty,
    'eval_averages', v_eval,
    'eval_count', v_eval_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_report_counts(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_counts(UUID, TEXT, TEXT) TO authenticated, service_role;
