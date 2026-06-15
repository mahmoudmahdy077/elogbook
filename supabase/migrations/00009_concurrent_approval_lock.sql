-- ============================================================================
-- Concurrent Supervisor Approval Lock
-- Prevents race conditions when two supervisors approve the same case simultaneously
-- ============================================================================

CREATE OR REPLACE FUNCTION approve_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
BEGIN
  -- Lock the row to prevent concurrent modifications
  SELECT status INTO v_status
  FROM case_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  -- Update case status
  UPDATE case_entries SET status = 'approved' WHERE id = p_entry_id;

  -- Upsert approval request
  INSERT INTO approval_requests (entry_id, supervisor_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, 'approved', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET status = 'approved', comment = p_comment, resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reject_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
BEGIN
  SELECT status INTO v_status
  FROM case_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  UPDATE case_entries SET status = 'rejected' WHERE id = p_entry_id;

  INSERT INTO approval_requests (entry_id, supervisor_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, 'rejected', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET status = 'rejected', comment = p_comment, resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'rejected'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
