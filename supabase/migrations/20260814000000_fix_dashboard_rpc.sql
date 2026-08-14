-- ============================================================================
-- 20260814000000_fix_dashboard_rpc.sql
--
-- Hotfix for production defect in 00094_dashboard_rpc.sql:
--
--   SELECT jsonb_agg(sub ORDER BY sub.created_at DESC)   -- ❌ sub.created_at
--   FROM (
--     SELECT ce.id, ce.case_date, ce.status,
--            ct.name AS template_name, ct.specialty AS template_specialty
--     ...
--   ) sub;
--
-- The subquery does NOT select created_at, so the aggregate's ORDER BY
-- references a non-existent column → ERROR 42703: column sub.created_at
-- does not exist. Every authenticated page that renders the dashboard
-- throws, redirect('/login') fires, middleware bounces the authed user
-- back → infinite redirect loop (all 39 authed-page sweep failures).
--
-- Fix: add ce.created_at to the subquery SELECT list. Idempotent
-- CREATE OR REPLACE — same signature, same grants.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_data(
  p_tenant_id    UUID,
  p_resident_id  UUID,
  p_role         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stats           JSONB;
  v_recent_cases    JSONB;
  v_pending_approvals BIGINT;
  v_total_residents BIGINT;
BEGIN
  -- ── Stats: counts by status (soft-deleted excluded) ──────────────────
  -- For residents, scope to their own cases; for directors+ return tenant-wide.
  SELECT jsonb_build_object(
    'draft',    COALESCE(count(*) FILTER (WHERE status = 'draft'),    0),
    'pending',  COALESCE(count(*) FILTER (WHERE status = 'pending'),  0),
    'approved', COALESCE(count(*) FILTER (WHERE status = 'approved'), 0),
    'rejected', COALESCE(count(*) FILTER (WHERE status = 'rejected'), 0)
  ) INTO v_stats
  FROM public.case_entries
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND (p_role != 'resident' OR (p_role = 'resident' AND resident_id = p_resident_id));

  -- ── Recent 5 cases with template name / specialty ───────────────────
  SELECT jsonb_agg(sub ORDER BY sub.created_at DESC)
  INTO v_recent_cases
  FROM (
    SELECT
      ce.id,
      ce.case_date,
      ce.status,
      ct.name     AS template_name,
      ct.specialty AS template_specialty,
      ce.created_at
    FROM public.case_entries ce
    JOIN public.case_templates ct ON ct.id = ce.template_id
    WHERE ce.tenant_id = p_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_role != 'resident' OR (p_role = 'resident' AND ce.resident_id = p_resident_id))
    ORDER BY ce.created_at DESC
    LIMIT 5
  ) sub;

  IF v_recent_cases IS NULL THEN
    v_recent_cases := '[]'::jsonb;
  END IF;

  -- ── Pending approvals (tenant-wide, any reviewer role) ──────────────
  SELECT COUNT(*) INTO v_pending_approvals
  FROM public.case_entries
  WHERE tenant_id = p_tenant_id
    AND status = 'pending'
    AND deleted_at IS NULL;

  -- ── Total residents in this tenant ──────────────────────────────────
  SELECT COUNT(*) INTO v_total_residents
  FROM public.profiles
  WHERE tenant_id = p_tenant_id
    AND role = 'resident';

  -- ── Assemble result ─────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'stats',              v_stats,
    'recent_cases',       v_recent_cases,
    'pending_approvals',  v_pending_approvals,
    'total_residents',    v_total_residents
  );
END;
$$;

-- ── Permissions (identical to 00094) ─────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  TO authenticated;
