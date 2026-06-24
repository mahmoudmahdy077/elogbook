-- ============================================================================
-- 00019: Fix Consent Records RLS Policy
-- 
-- The "Admin can read all tenant consent records" policy used p.id = auth.uid()
-- but profiles.id is the primary key, NOT the auth.users.id.
-- profiles.user_id is the foreign key to auth.users.id.
-- ============================================================================

DROP POLICY IF EXISTS "Admin can read all tenant consent records" ON consent_records;

CREATE POLICY "Admin can read all tenant consent records"
  ON consent_records FOR SELECT
  USING (tenant_id IN (
    SELECT t.id FROM tenants t
    JOIN profiles p ON p.tenant_id = t.id
    WHERE p.user_id = auth.uid()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  ));
