-- ============================================================================
-- 00048_fix_approval_tenant_id.sql
--
-- Phase 0 / P0.5
--
-- Bug: approve_case() and reject_case() INSERT into approval_requests
--      without populating tenant_id. Migration 00028 made tenant_id
--      NOT NULL on approval_requests, so every supervisor call raised
--      a NOT NULL violation, leaving case_entries.status stuck at
--      'pending' and breaking the entire approval flow.
--
-- Fix: source tenant_id from the case_entries row (v_tenant_id) and
--      include it in the INSERT. The defense-in-depth cross-check
--      against get_tenant_id() is already in place above the INSERT
--      in both functions, so we are simply propagating a value that
--      has already been validated.
--
-- Iron rules honored:
--   * SECURITY DEFINER + auth check preserved
--   * SET search_path = '' preserved (NOT 'public'; the empty string
--     is the project's convention per 00020 and is the safe choice
--     to block search-path hijacking)
--   * Idempotent (CREATE OR REPLACE)
--   * No secrets in body
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. approve_case — add tenant_id to the INSERT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_tenant_id UUID;
BEGIN
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  -- Defense-in-depth: cross-check tenant_id against the caller's tenant.
  -- This was already present in 00020; the fix below re-uses v_tenant_id
  -- (which has just been validated here) as the source for the approval
  -- row. This means the approval row's tenant_id is guaranteed to equal
  -- get_tenant_id() at insert time.
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

  -- FIX (P0.5): include tenant_id, sourced from the case row.
  INSERT INTO approval_requests (entry_id, supervisor_id, tenant_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, v_tenant_id, 'approved', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET
    tenant_id   = EXCLUDED.tenant_id,
    status      = 'approved',
    comment     = p_comment,
    resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ---------------------------------------------------------------------------
-- 2. reject_case — same fix, mirrored
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_tenant_id UUID;
BEGIN
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
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

  -- FIX (P0.5): include tenant_id, sourced from the case row.
  INSERT INTO approval_requests (entry_id, supervisor_id, tenant_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, v_tenant_id, 'rejected', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET
    tenant_id   = EXCLUDED.tenant_id,
    status      = 'rejected',
    comment     = p_comment,
    resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'rejected'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
