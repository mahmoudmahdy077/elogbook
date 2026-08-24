-- ============================================================================
-- FIX: approve_case / reject_case FK violation on approval_requests.supervisor_id
--
-- BUG: The RPCs validate p_supervisor_id == auth.uid() (correct — callers pass
-- the Supabase auth UID from supabase.auth.getUser()), then insert that same
-- auth UID into approval_requests.supervisor_id. But that column FKs to
-- profiles(id) — and profiles.id is a gen_random_uuid() surrogate key, NOT the
-- auth user id (profiles link to auth.users via profiles.user_id). Every
-- profile created by handle_new_user() or seed_demo_accounts() therefore has
-- profiles.id != auth.uid(), so EVERY approve/reject action dies with:
--   23503: insert or update on table "approval_requests" violates foreign key
--   constraint "approval_requests_supervisor_id_fkey"
--
-- FIX: resolve v_profile_id := (SELECT id FROM profiles WHERE user_id = auth.uid())
-- inside both functions and use it for the approval_requests insert, while
-- keeping the p_supervisor_id == auth.uid() caller check unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_tenant_id UUID;
  v_profile_id UUID;
BEGIN
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  IF p_supervisor_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Supervisor ID does not match authenticated user', 'code', 'forbidden');
  END IF;

  -- Resolve the profiles row for the authenticated user. profiles.id is a
  -- surrogate key; auth users link via profiles.user_id = auth.uid().
  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Profile not found for authenticated user', 'code', 'forbidden');
  END IF;

  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  IF v_tenant_id != get_tenant_id() THEN
    RETURN jsonb_build_object('error', 'Case does not belong to your tenant', 'code', 'forbidden');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  UPDATE case_entries SET status = 'approved' WHERE id = p_entry_id;

  INSERT INTO approval_requests (entry_id, supervisor_id, tenant_id, status, comment, resolved_at)
  VALUES (p_entry_id, v_profile_id, v_tenant_id, 'approved', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET
    tenant_id   = EXCLUDED.tenant_id,
    status      = 'approved',
    comment     = EXCLUDED.comment,
    resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object('success', TRUE, 'approval_id', v_approval_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.reject_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_tenant_id UUID;
  v_profile_id UUID;
BEGIN
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  IF p_supervisor_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Supervisor ID does not match authenticated user', 'code', 'forbidden');
  END IF;

  -- Resolve the profiles row for the authenticated user.
  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Profile not found for authenticated user', 'code', 'forbidden');
  END IF;

  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  IF v_tenant_id != get_tenant_id() THEN
    RETURN jsonb_build_object('error', 'Case does not belong to your tenant', 'code', 'forbidden');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  UPDATE case_entries SET status = 'rejected' WHERE id = p_entry_id;

  INSERT INTO approval_requests (entry_id, supervisor_id, tenant_id, status, comment, resolved_at)
  VALUES (p_entry_id, v_profile_id, v_tenant_id, 'rejected', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET
    tenant_id   = EXCLUDED.tenant_id,
    status      = 'rejected',
    comment     = p_comment,
    resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object('success', TRUE, 'approval_id', v_approval_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


REVOKE EXECUTE ON FUNCTION public.approve_case(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_case(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_case(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_case(UUID, UUID, TEXT) TO authenticated;
