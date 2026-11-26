-- ============================================================================
-- 20261126000300_storage_attachment_owner_scope.sql
--
-- The case_attachments table was owner-scoped in 20261126000000, but the
-- storage.objects policies still allowed every member of a tenant to list,
-- download, overwrite and delete every other member's PHI files. Objects are
-- stored at <tenant-slug>/<case-id>/<file>.
--
-- Also in this file:
--   * get_dashboard_data trusted p_role / p_resident_id from the request, so a
--     resident could ask for tenant-wide counts and the five most recent cases
--     of every other resident.
--   * get_duty_4wk_violations trusted a caller-supplied p_tenant_id and is
--     SECURITY DEFINER, so any authenticated user could read another tenant's
--     rolling duty hours.
--   * decrypt_with_version was executable by `authenticated`, which let a
--     director decrypt tenant_webhooks.secret_enc directly and bypass the
--     secret_tenant_webhooks role gate. The secret views run as their owner, so
--     they do not need the grant.
--
-- destructive: no — policies/functions replaced, one EXECUTE grant revoked.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. case-attachments storage: owner or supervisor+
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS case_att_select_tenant_folder ON storage.objects;
DROP POLICY IF EXISTS case_att_update_tenant_folder ON storage.objects;
DROP POLICY IF EXISTS case_att_delete_tenant_folder ON storage.objects;
DROP POLICY IF EXISTS case_att_insert_tenant_folder ON storage.objects;
DROP POLICY IF EXISTS "tenant attachment access" ON storage.objects;

CREATE POLICY case_att_select_owner ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_slug()
    AND (
      public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
      OR (storage.foldername(name))[2] IN (
        SELECT ce.id::text
        FROM public.case_entries ce
        JOIN public.profiles p ON p.id = ce.resident_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY case_att_insert_owner ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_slug()
    AND (
      public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
      OR (storage.foldername(name))[2] IN (
        SELECT ce.id::text
        FROM public.case_entries ce
        JOIN public.profiles p ON p.id = ce.resident_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

CREATE POLICY case_att_update_owner ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_slug()
    AND (
      public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
      OR (storage.foldername(name))[2] IN (
        SELECT ce.id::text
        FROM public.case_entries ce
        JOIN public.profiles p ON p.id = ce.resident_id
        WHERE p.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_slug()
  );

CREATE POLICY case_att_delete_owner ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = public.current_tenant_slug()
    AND (
      public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
      OR (storage.foldername(name))[2] IN (
        SELECT ce.id::text
        FROM public.case_entries ce
        JOIN public.profiles p ON p.id = ce.resident_id
        WHERE p.user_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. get_dashboard_data: derive role and resident from the JWT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_data(
  p_tenant_id uuid,
  p_resident_id uuid,
  p_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_stats           JSONB;
  v_recent_cases    JSONB;
  v_pending_approvals BIGINT;
  v_total_residents BIGINT;
  v_role            TEXT;
  v_resident        UUID;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant dashboard access denied' USING ERRCODE = '42501';
    END IF;
    -- Never trust the caller's claimed role or resident id.
    v_role := get_user_role();
    SELECT id INTO v_resident FROM public.profiles WHERE user_id = auth.uid();
  ELSE
    v_role := COALESCE(p_role, 'resident');
    v_resident := p_resident_id;
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
    AND (v_role <> 'resident' OR resident_id = v_resident);

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
      AND (v_role <> 'resident' OR ce.resident_id = v_resident)
    ORDER BY ce.created_at DESC
    LIMIT 5
  ) sub;

  IF v_recent_cases IS NULL THEN
    v_recent_cases := '[]'::jsonb;
  END IF;

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
    'pending_approvals',  v_pending_approvals,
    'total_residents',    v_total_residents
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. get_duty_4wk_violations: only service_role may name another tenant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_duty_4wk_violations(p_tenant_id uuid)
RETURNS TABLE(tenant_id uuid, resident_id uuid, window_start date, window_end date, avg_hours numeric, weeks_in_window bigint, week_hours numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    v.tenant_id,
    v.resident_id,
    v.window_start,
    v.window_end,
    v.avg_hours,
    v.weeks_in_window::BIGINT,
    v.week_hours
  FROM public.duty_4wk_violations v
  WHERE v.tenant_id = CASE
    WHEN auth.role() = 'service_role' AND p_tenant_id IS NOT NULL THEN p_tenant_id
    ELSE public.get_tenant_id()
  END
  ORDER BY v.resident_id, v.window_end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. decrypt_with_version: views are definer-owned, so authenticated does not
--    need direct EXECUTE.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.decrypt_with_version(bytea, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_with_version(bytea, integer) FROM anon;

-- ---------------------------------------------------------------------------
-- 5. anon has no business touching the secret-config tables or views.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.ai_config FROM anon;
REVOKE ALL ON public.payment_gateway_config FROM anon;
REVOKE ALL ON public.secret_ai_config FROM anon;
REVOKE ALL ON public.secret_payment_gateway_config FROM anon;
