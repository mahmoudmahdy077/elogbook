-- ============================================================================
-- 20261016000000_benchmark_rpc.sql
-- P0-3: Multi-institution benchmarking — tenant-scoped comparison RPC.
--
-- benchmark_data / benchmark_mv (mig 00092) plus the nightly refresh
-- (20260826160000) exist, but nothing consumes them: a program director
-- needs their OWN tenant's numbers against the (de-identified) peer pool.
--
-- This RPC computes, per specialty + procedure the caller's tenant logs:
--   * own approved case count, own resident count, own avg per resident
--   * peer (all other tenants) avg per resident, peer tenant count,
--     peer resident count
--   * percentile of own avg per resident among ALL tenants logging that
--     specialty/procedure (percent_rank * 100, 0 = lowest)
--
-- De-identification: only aggregate counts/averages/percentiles leave the
-- database. Peer tenant IDs/names are never returned; peer rows are
-- pre-aggregated before projection. audit_logs is not written because the
-- RPC is read-only and writes no identifiable data.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_benchmark_comparison(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant benchmark access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  WITH tenant_stats AS (
    SELECT
      ce.tenant_id,
      ct.specialty,
      ct.name AS procedure_type,
      count(*)::int AS cases,
      count(DISTINCT ce.resident_id)::int AS residents
    FROM public.case_entries ce
    JOIN public.case_templates ct ON ct.id = ce.template_id
    WHERE ce.deleted_at IS NULL AND ce.status = 'approved'
    GROUP BY ce.tenant_id, ct.specialty, ct.name
  ),
  tenant_avgs AS (
    SELECT
      tenant_id,
      specialty,
      procedure_type,
      cases,
      residents,
      cases::numeric / NULLIF(residents, 0) AS avg_per_resident
    FROM tenant_stats
  ),
  ranked AS (
    SELECT
      tenant_id,
      specialty,
      procedure_type,
      cases,
      residents,
      avg_per_resident,
      percent_rank() OVER (
        PARTITION BY specialty, procedure_type
        ORDER BY avg_per_resident
      ) AS percentile
    FROM tenant_avgs
  ),
  peers AS (
    SELECT
      specialty,
      procedure_type,
      avg(avg_per_resident) AS peer_avg,
      count(*)::int AS peer_tenants,
      sum(residents)::int AS peer_residents
    FROM tenant_avgs
    WHERE tenant_id IS DISTINCT FROM p_tenant_id
    GROUP BY specialty, procedure_type
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'specialty', r.specialty,
          'procedure_type', r.procedure_type,
          'own_cases', r.cases,
          'own_residents', r.residents,
          'own_avg_per_resident', round(r.avg_per_resident, 1),
          'peer_avg_per_resident', round(p.peer_avg, 1),
          'peer_tenant_count', COALESCE(p.peer_tenants, 0),
          'peer_total_residents', COALESCE(p.peer_residents, 0),
          'percentile', round((r.percentile * 100)::numeric, 0)
        )
        ORDER BY r.specialty, r.procedure_type
      ),
      '[]'::jsonb
    )
  INTO v_result
  FROM ranked r
  LEFT JOIN peers p USING (specialty, procedure_type)
  WHERE r.tenant_id = p_tenant_id;

  IF v_result IS NULL THEN
    SELECT '[]'::jsonb INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_benchmark_comparison(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_benchmark_comparison(UUID) TO authenticated, service_role;
