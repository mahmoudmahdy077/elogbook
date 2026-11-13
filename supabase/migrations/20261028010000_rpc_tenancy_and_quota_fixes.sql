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

-- ── 4. The secret_* views could not decrypt for their audience --------------
-- 00062 revoked EXECUTE on decrypt_with_version() from anon/authenticated on
-- the assumption that the views run the helper as their owner. They do not:
-- function EXECUTE is checked against the invoker even inside a
-- non-security_invoker view, so an institution_admin reading
-- secret_ai_config got 42501 instead of the key (verified on the linked
-- project as well). The views keep the tenant/role gate; the helper still
-- needs the per-connection app.encryption_key GUC, which no client can set.
GRANT EXECUTE ON FUNCTION public.decrypt_with_version(BYTEA, INT) TO authenticated;

-- ── 5. submit_case_operation must never raise on client input --------------
-- With no row identity in the payload (missing row id, unknown template) the
-- audit insert violated audit_logs.resource_id NOT NULL, turning a validation
-- result into a 23502 error. Re-created with the guard; behaviour is
-- otherwise unchanged.
CREATE OR REPLACE FUNCTION public.submit_case_operation(
  p_op_id TEXT,
  p_action TEXT,
  p_row_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
  v_status TEXT;
  v_row case_entries;
  v_new_id UUID;
  v_result JSONB;
  v_claim TEXT;
  v_claimed_at TIMESTAMPTZ;
  v_key TEXT;
  v_is_deidentified BOOLEAN;
  v_resource_id UUID;
BEGIN
  IF p_op_id IS NULL OR char_length(p_op_id) < 1 OR char_length(p_op_id) > 64 THEN
    RAISE EXCEPTION 'invalid operation id' USING ERRCODE = 'P0004';
  END IF;
  IF p_action NOT IN ('insert', 'update', 'delete') THEN
    RAISE EXCEPTION 'invalid action' USING ERRCODE = 'P0004';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid payload' USING ERRCODE = 'P0004';
  END IF;

  -- Caller identity from the JWT (never from payload).
  SELECT id, tenant_id, role, COALESCE(status, 'active')
    INTO v_profile_id, v_tenant_id, v_role, v_status
  FROM public.profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: profile_not_found');
  END IF;
  IF v_status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: account_suspended');
  END IF;

  -- Replay + mutual exclusion: claim the op ID BEFORE doing work. A recorded
  -- result returns untouched (replay-safe). A concurrent duplicate sees
  -- in_progress and retries (never forks a second row). A stale in_progress
  -- claim (crashed worker, > 10 min) is reclaimed by the new worker.
  INSERT INTO public.case_operation_log (op_id, tenant_id, actor_profile_id, action, result)
  VALUES (p_op_id, v_tenant_id, v_profile_id, p_action, '{"success":false,"error":"in_progress"}'::jsonb)
  ON CONFLICT (op_id) DO NOTHING
  RETURNING op_id INTO v_claim;
  IF v_claim IS NULL THEN
    SELECT result, created_at INTO v_result, v_claimed_at
      FROM public.case_operation_log WHERE op_id = p_op_id;
    IF v_result IS NOT NULL AND v_result ->> 'error' = 'in_progress'
       AND NOW() - v_claimed_at > interval '10 minutes' THEN
      UPDATE public.case_operation_log
         SET actor_profile_id = v_profile_id, action = p_action, created_at = NOW()
       WHERE op_id = p_op_id AND result ->> 'error' = 'in_progress';
      IF FOUND THEN
        v_claim := p_op_id;
      ELSE
        SELECT result INTO v_result FROM public.case_operation_log WHERE op_id = p_op_id;
      END IF;
    END IF;
    IF v_claim IS NULL THEN
      IF v_result IS NULL THEN
        v_result := jsonb_build_object('success', false, 'error', 'transient: op_in_progress');
      END IF;
      RETURN v_result;
    END IF;
  END IF;

  -- Single-exit work block: every denial assigns v_result and exits; the
  -- shared finalize below records the op log + audit exactly once, so no
  -- denial can strand the claim in 'in_progress'. Unexpected row errors
  -- (quota/status/PHI triggers, bad casts) are recorded as terminal results
  -- instead of wedging the claim: only a torn connection leaves in_progress
  -- for the 10-minute stale takeover above.
  <<work>> BEGIN
  IF p_action = 'insert' THEN
    -- Unknown keys rejected (client drift fails loudly, not silently).
    FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
      IF v_key NOT IN ('template_id','patient_mrn','patient_dob','patient_age_years',
                       'patient_hash','case_date','field_values','status','is_deidentified') THEN
        v_result := jsonb_build_object('success', false, 'error', 'validation: invalid_column:' || v_key);
        EXIT work;
      END IF;
    END LOOP;
    v_is_deidentified := COALESCE((p_payload ->> 'is_deidentified')::boolean, TRUE);
    IF NOT v_is_deidentified AND NOT public.tenant_identifiable_allowed(v_tenant_id) THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: identifiable_not_permitted');
      EXIT work;
    END IF;
    INSERT INTO public.case_entries (
      tenant_id, resident_id, template_id, patient_mrn, patient_dob,
      patient_age_years, patient_hash, case_date, field_values, status,
      is_deidentified, client_operation_id
    ) VALUES (
      v_tenant_id, v_profile_id,
      NULLIF(p_payload ->> 'template_id', '')::uuid,
      NULLIF(p_payload ->> 'patient_mrn', ''),
      NULLIF(p_payload ->> 'patient_dob', '')::date,
      NULLIF(p_payload ->> 'patient_age_years', '')::int,
      NULLIF(p_payload ->> 'patient_hash', ''),
      COALESCE(NULLIF(p_payload ->> 'case_date', '')::date, CURRENT_DATE),
      COALESCE(p_payload -> 'field_values', '{}'::jsonb),
      COALESCE(p_payload ->> 'status', 'draft'),
      v_is_deidentified,
      p_op_id
    ) RETURNING id INTO v_new_id;
    v_result := jsonb_build_object('success', true, 'id', v_new_id, 'op_id', p_op_id);

  ELSIF p_action = 'update' THEN
    IF p_row_id IS NULL THEN
      v_result := jsonb_build_object('success', false, 'error', 'validation: missing_row_id');
      EXIT work;
    END IF;
    SELECT * INTO v_row FROM public.case_entries
     WHERE id = p_row_id AND tenant_id = v_tenant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_found');
      EXIT work;
    END IF;
    IF v_row.resident_id <> v_profile_id
       AND v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: forbidden');
      EXIT work;
    END IF;
    IF v_row.status = 'approved'
       AND v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: approved_locked');
      EXIT work;
    END IF;
    -- Immutable identity/audit fields can never move through this path.
    FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
      IF v_key IN ('id','tenant_id','resident_id','created_at','patient_hash','client_operation_id') THEN
        v_result := jsonb_build_object('success', false, 'error', 'validation: immutable_column:' || v_key);
        EXIT work;
      END IF;
      IF v_key NOT IN ('template_id','patient_mrn','patient_dob','patient_age_years',
                       'case_date','field_values','status','is_deidentified') THEN
        v_result := jsonb_build_object('success', false, 'error', 'validation: invalid_column:' || v_key);
        EXIT work;
      END IF;
    END LOOP;
    -- Mode flips are rejected here; the trigger is the second lock.
    IF (p_payload ? 'is_deidentified')
       AND (p_payload ->> 'is_deidentified')::boolean IS DISTINCT FROM v_row.is_deidentified THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: mode_immutable');
      EXIT work;
    END IF;
    IF (NOT COALESCE(v_row.is_deidentified, TRUE))
       AND NOT public.tenant_identifiable_allowed(v_tenant_id)
       AND ((p_payload ? 'patient_mrn' AND NULLIF(p_payload ->> 'patient_mrn', '') IS DISTINCT FROM v_row.patient_mrn)
            OR (p_payload ? 'patient_dob' AND NULLIF(p_payload ->> 'patient_dob', '')::date IS DISTINCT FROM v_row.patient_dob)) THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: identifier_locked');
      EXIT work;
    END IF;
    UPDATE public.case_entries SET
      template_id = COALESCE(NULLIF(p_payload ->> 'template_id', '')::uuid, template_id),
      patient_mrn = CASE WHEN p_payload ? 'patient_mrn' THEN NULLIF(p_payload ->> 'patient_mrn', '') ELSE patient_mrn END,
      patient_dob = CASE WHEN p_payload ? 'patient_dob' THEN NULLIF(p_payload ->> 'patient_dob', '')::date ELSE patient_dob END,
      patient_age_years = CASE WHEN p_payload ? 'patient_age_years' THEN NULLIF(p_payload ->> 'patient_age_years', '')::int ELSE patient_age_years END,
      case_date = COALESCE(NULLIF(p_payload ->> 'case_date', '')::date, case_date),
      field_values = COALESCE(p_payload -> 'field_values', field_values),
      status = COALESCE(p_payload ->> 'status', status),
      updated_at = NOW()
     WHERE id = v_row.id;
    v_result := jsonb_build_object('success', true, 'id', v_row.id, 'op_id', p_op_id);

  ELSE -- delete: real tombstone, idempotent.
    IF p_row_id IS NULL THEN
      v_result := jsonb_build_object('success', false, 'error', 'validation: missing_row_id');
      EXIT work;
    END IF;
    SELECT * INTO v_row FROM public.case_entries
     WHERE id = p_row_id AND tenant_id = v_tenant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.case_entries
                  WHERE id = p_row_id AND tenant_id = v_tenant_id AND deleted_at IS NOT NULL) THEN
        v_result := jsonb_build_object('success', true, 'already_deleted', true, 'op_id', p_op_id);
      ELSE
        v_result := jsonb_build_object('success', false, 'error', 'not_found');
      END IF;
    ELSE
      IF v_row.resident_id <> v_profile_id
         AND v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
        v_result := jsonb_build_object('success', false, 'error', 'policy: forbidden');
      ELSE
        UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_row.id;
        v_result := jsonb_build_object('success', true, 'id', v_row.id, 'op_id', p_op_id);
      END IF;
    END IF;
  END IF;
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object('success', false, 'error', 'db: ' || LEFT(SQLERRM, 300));
  END; -- <<work>>

  -- Operation log + audit in the same transaction (no swallow). Denials are
  -- recorded too, so replays return the terminal denial instead of retrying.
  UPDATE public.case_operation_log
     SET tenant_id = v_tenant_id, actor_profile_id = v_profile_id, action = p_action,
         row_id = CASE WHEN p_action = 'insert' THEN (v_result ->> 'id')::uuid ELSE p_row_id END,
         result = v_result
   WHERE op_id = p_op_id;

  -- A client error can leave no row identity at all (missing row id, unknown
  -- template). audit_logs.resource_id is NOT NULL, so skipping the audit row
  -- keeps the RPC returning its result instead of raising 23502; the denial is
  -- still recorded in case_operation_log above.
  v_resource_id := COALESCE((v_result ->> 'id')::uuid, p_row_id);
  IF v_resource_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (v_tenant_id, auth.uid(), 'case_' || p_action, 'case_entries',
            v_resource_id,
            jsonb_build_object('op_id', p_op_id,
                               'denied', COALESCE((v_result ->> 'success')::boolean, FALSE) = FALSE));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) TO authenticated, service_role;
