-- ============================================================================
-- 00014: Add missing RLS SELECT policies on audit_logs
-- ============================================================================
-- Migration 00012 dropped the INSERT policy on audit_logs but never added
-- a SELECT policy. Admins cannot read audit logs - they're completely blind
-- to the audit trail. This migration adds the missing SELECT policies.
-- ============================================================================

-- Ensure RLS is enabled (should be from 00001)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 1. Admin/Director/Institution Admin: read all tenant audit logs
--    (Updates existing policy to include 'supervisor' role)
-- ============================================================================

DROP POLICY IF EXISTS "Admin roles can read audit logs" ON audit_logs;

CREATE POLICY "Admins read all tenant audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

-- ============================================================================
-- 2. Supervisor: read all tenant audit logs
-- ============================================================================

CREATE POLICY "Supervisors read all tenant audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() = 'supervisor'
  );

-- ============================================================================
-- 3. Resident: read own audit logs
-- ============================================================================

CREATE POLICY "Residents read own audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND user_id = auth.uid()
  );

-- ============================================================================
-- 4. Supervisor: read audit logs for cases they supervise (resource_type = 'case_entries')
-- ============================================================================

CREATE POLICY "Supervisors read supervised case audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND resource_type = 'case_entries'
    AND resource_id IN (
      SELECT ce.id FROM case_entries ce
      WHERE ce.tenant_id = get_tenant_id()
      AND ce.deleted_at IS NULL
    )
  );
