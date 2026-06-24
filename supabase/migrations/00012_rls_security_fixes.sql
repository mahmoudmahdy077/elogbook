-- ============================================================================
-- 00012: RLS Security Fixes
-- ============================================================================

-- ============================================================================
-- 1. Revoke INSERT on audit_logs from authenticated users
--    Only triggers and service_role should write audit logs.
-- ============================================================================

DROP POLICY IF EXISTS "Any authenticated user can insert audit logs" ON audit_logs;

CREATE POLICY "Block all authenticated INSERTs on audit_logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- ============================================================================
-- 2. Fix profile INSERT role escalation — only allow 'resident' and 'supervisor'
--    at signup. Higher roles must be assigned by an admin after creation.
-- ============================================================================

DROP POLICY IF EXISTS "Any authenticated user can insert own profile" ON profiles;

CREATE POLICY "Authenticated user can insert own profile with restricted role"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role IN ('resident', 'supervisor')
  );

-- ============================================================================
-- 3. Add role CHECK constraint on profiles
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_insert_check') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_role_insert_check
      CHECK (role IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin'));
  END IF;
END $$;

-- ============================================================================
-- 4. Fix approve_case() and reject_case() — add authorization checks
-- ============================================================================

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
  -- Authorization: only supervisor+ can approve
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  -- Lock the row and fetch tenant_id for authorization
  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  -- Authorization: caller's tenant must match the case's tenant
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
  v_tenant_id UUID;
BEGIN
  -- Authorization: only supervisor+ can reject
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  -- Lock the row and fetch tenant_id for authorization
  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  -- Authorization: caller's tenant must match the case's tenant
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

-- ============================================================================
-- 5. Fix get_case_stats() — remove p_tenant_id parameter, use only JWT
--    Also filter by deleted_at IS NULL.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_case_stats(
  p_resident_id UUID DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_tenant_id UUID;
BEGIN
  v_tenant_id := get_tenant_id();

  SELECT jsonb_build_object(
    'total_cases', COALESCE((SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      AND (p_from_date IS NULL OR ce.case_date >= p_from_date)
      AND (p_to_date IS NULL OR ce.case_date <= p_to_date)), 0),
    'by_status', (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::JSONB) FROM (
      SELECT status, COUNT(*) AS cnt FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      GROUP BY status
    ) sub),
    'by_specialty', (SELECT COALESCE(jsonb_object_agg(ct.specialty, cnt), '{}'::JSONB) FROM (
      SELECT ct.specialty, COUNT(*) AS cnt FROM case_entries ce
      JOIN case_templates ct ON ct.id = ce.template_id
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      GROUP BY ct.specialty
    ) sub),
    'by_month', (SELECT COALESCE(jsonb_object_agg(month, cnt), '{}'::JSONB) FROM (
      SELECT to_char(ce.case_date, 'YYYY-MM') AS month, COUNT(*) AS cnt FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      AND (p_from_date IS NULL OR ce.case_date >= p_from_date)
      AND (p_to_date IS NULL OR ce.case_date <= p_to_date)
      GROUP BY month ORDER BY month
    ) sub),
    'pending_approvals', COALESCE((SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND ce.status = 'pending'), 0),
    'rejection_rate', CASE
      WHEN (SELECT COUNT(*) FROM case_entries ce
        WHERE ce.tenant_id = v_tenant_id
        AND ce.deleted_at IS NULL
        AND ce.status IN ('approved', 'rejected')) > 0
      THEN ROUND(
        ((SELECT COUNT(*) FROM case_entries ce
          WHERE ce.tenant_id = v_tenant_id AND ce.deleted_at IS NULL AND ce.status = 'rejected')::NUMERIC
        / (SELECT COUNT(*) FROM case_entries ce
          WHERE ce.tenant_id = v_tenant_id AND ce.deleted_at IS NULL AND ce.status IN ('approved', 'rejected'))::NUMERIC) * 100, 2
      )
      ELSE 0
    END
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- 6. Fix lapsed tenant write guard policies
--    Replace with precise versions that:
--    - Block INSERTs for lapsed tenants
--    - Block draft→pending transitions for lapsed tenants
--    - Allow draft→draft (editing) regardless
--    - Allow supervisor+ to update regardless of subscription
--    - Add deleted_at IS NULL filter
-- ============================================================================

DROP POLICY IF EXISTS no_inserts_for_lapsed_tenants ON case_entries;
DROP POLICY IF EXISTS no_submit_for_lapsed_tenants ON case_entries;

CREATE POLICY no_inserts_for_lapsed_tenants
  ON case_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin') THEN true
      ELSE NOT EXISTS (
        SELECT 1
        FROM subscriptions
        WHERE subscriptions.tenant_id = case_entries.tenant_id
          AND subscriptions.status IN ('past_due', 'unpaid')
      )
    END
  );

-- no_submit_for_lapsed_tenants policy removed - handled by trigger in 00010
-- OLD cannot be used in WITH CHECK; use BEFORE UPDATE trigger instead

-- ============================================================================
-- 7. Fix handle_new_user() trigger — restrict roles to 'resident' and 'supervisor'
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  role_text TEXT;
BEGIN
  role_text := COALESCE(NEW.raw_user_meta_data->>'role', 'resident');

  -- Only allow 'resident' and 'supervisor' at signup; everything else defaults to 'resident'
  IF role_text NOT IN ('resident', 'supervisor') THEN
    role_text := 'resident';
  END IF;

  -- Create personal tenant for the user
  INSERT INTO tenants (name, slug, tenant_type)
  VALUES (NEW.email, 'user-' || NEW.id, 'individual')
  RETURNING id INTO new_tenant_id;

  -- Create profile
  INSERT INTO profiles (tenant_id, user_id, role, full_name)
  VALUES (
    new_tenant_id,
    NEW.id,
    role_text,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  -- Set tenant_id and role in JWT claims
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_build_object(
    'tenant_id', new_tenant_id,
    'user_role', role_text
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 8. Add deleted_at IS NULL filter to case_entries SELECT policies
-- ============================================================================

DROP POLICY IF EXISTS "Resident reads own entries" ON case_entries;
DROP POLICY IF EXISTS "Supervisor+ reads all tenant entries" ON case_entries;

CREATE POLICY "Resident reads own entries"
  ON case_entries FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND deleted_at IS NULL
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisor+ reads all tenant entries"
  ON case_entries FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND deleted_at IS NULL
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );