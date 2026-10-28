-- ============================================================================
-- 20261028010000_rpc_tenancy_and_quota_fixes.sql
--
-- Three defects found by the db-tests suites once a clean replay got past
-- `supabase start`:
--
-- 1. resident_ai_toggle.updated_at does not exist, but consume_ai_quota(),
--    release_ai_quota() and grant_ai_quota() all write it. Every AI quota
--    call therefore raised 42703 instead of moving the counter
--    (p2_08_ai_quota_release.sql).
--
-- 2. sync_push_batch() was "retired" by revoking EXECUTE from
--    `authenticated`, but the function's default PUBLIC grant still gave
--    every signed-in user the bypass (p3_05_definer_audit.sql).
--
-- 3. get_dashboard_data() and get_template_usage_counts() are SECURITY
--    DEFINER and trusted their p_tenant_id argument, so any authenticated
--    user could read another tenant's dashboard / template usage
--    (p2_02_rpc_tenant_checks.sql).
-- ============================================================================

-- ── 1. Missing column -------------------------------------------------------
ALTER TABLE public.resident_ai_toggle
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public.resident_ai_toggle.updated_at IS
  'Last quota change; written by consume_ai_quota/release_ai_quota/grant_ai_quota.';

-- ── 2. Retire the offline-sync bypass for real ------------------------------
REVOKE ALL ON FUNCTION public.sync_push_batch(TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ── 3a. Tenant guard on get_dashboard_data ----------------------------------
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
  -- Same guard shape as get_analytics_data: the caller's JWT tenant wins.
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant dashboard access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  TO authenticated, service_role;

-- ── 3b. Tenant guard on get_template_usage_counts ---------------------------
CREATE OR REPLACE FUNCTION public.get_template_usage_counts(
  p_tenant_id UUID,
  p_resident_id UUID
)
RETURNS TABLE(template_id UUID, personal_count BIGINT, tenant_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant template usage access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT ct.id,
         COUNT(ce) FILTER (WHERE ce.resident_id = p_resident_id),
         COUNT(ce)
  FROM public.case_templates ct
  LEFT JOIN public.case_entries ce
    ON ce.template_id = ct.id
   AND ce.deleted_at IS NULL
   AND ce.tenant_id = p_tenant_id
  WHERE ct.tenant_id IN (p_tenant_id, '00000000-0000-0000-0000-000000000000')
  GROUP BY ct.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_template_usage_counts(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_template_usage_counts(UUID, UUID)
  TO authenticated, service_role;
