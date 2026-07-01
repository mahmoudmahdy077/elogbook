-- Fix approve_case and reject_case RPCs to include tenant_id
-- Critical fix for supervisor approval workflow

CREATE OR REPLACE FUNCTION approve_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_tenant_id UUID;
BEGIN
  -- Check permissions
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  -- Lock and get case
  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  -- Verify tenant
  IF v_tenant_id != get_tenant_id() THEN
    RETURN jsonb_build_object('error', 'Case does not belong to your tenant', 'code', 'forbidden');
  END IF;

  -- Check if already reviewed
  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  -- Update case status
  UPDATE case_entries SET status = 'approved', updated_at = NOW() WHERE id = p_entry_id;

  -- Insert approval record with tenant_id
  INSERT INTO approval_requests (entry_id, supervisor_id, tenant_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, v_tenant_id, 'approved', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    status = 'approved',
    comment = p_comment,
    resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'approved'
  );
END;
$$;

CREATE OR REPLACE FUNCTION reject_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_tenant_id UUID;
BEGIN
  -- Check permissions
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  -- Lock and get case
  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  -- Verify tenant
  IF v_tenant_id != get_tenant_id() THEN
    RETURN jsonb_build_object('error', 'Case does not belong to your tenant', 'code', 'forbidden');
  END IF;

  -- Check if already reviewed
  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  -- Update case status
  UPDATE case_entries SET status = 'rejected', updated_at = NOW() WHERE id = p_entry_id;

  -- Insert rejection record with tenant_id
  INSERT INTO approval_requests (entry_id, supervisor_id, tenant_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, v_tenant_id, 'rejected', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    status = 'rejected',
    comment = p_comment,
    resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'rejected'
  );
END;
$$;

-- Grant execution to authenticated users
REVOKE EXECUTE ON FUNCTION approve_case FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION approve_case TO authenticated;
REVOKE EXECUTE ON FUNCTION reject_case FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reject_case TO authenticated;