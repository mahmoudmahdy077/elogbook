-- Migration 00028: Add missing tenant_id for direct tenant isolation
-- Case attachments, one time purchases, and approval requests previously relied
-- on indirect tenant checks through JOINs. This adds direct tenant_id columns.

-- case_attachments
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE case_attachments ca
  SET tenant_id = ce.tenant_id
  FROM case_entries ce
  WHERE ca.entry_id = ce.id AND ca.tenant_id IS NULL;
ALTER TABLE case_attachments ALTER COLUMN tenant_id SET NOT NULL;

-- one_time_purchases
ALTER TABLE one_time_purchases ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE one_time_purchases otp
  SET tenant_id = p.tenant_id
  FROM profiles p
  WHERE otp.resident_id = p.id AND otp.tenant_id IS NULL;
ALTER TABLE one_time_purchases ALTER COLUMN tenant_id SET NOT NULL;

-- approval_requests
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE approval_requests ar
  SET tenant_id = ce.tenant_id
  FROM case_entries ce
  WHERE ar.entry_id = ce.id AND ar.tenant_id IS NULL;
ALTER TABLE approval_requests ALTER COLUMN tenant_id SET NOT NULL;

-- Replace RLS policies on case_attachments with direct tenant_id checks
DROP POLICY IF EXISTS "Users read attachments on own tenant entries" ON case_attachments;
DROP POLICY IF EXISTS "Users can insert attachments for own entries" ON case_attachments;
DROP POLICY IF EXISTS "Supervisor+ can delete attachments in tenant" ON case_attachments;

CREATE POLICY "Tenant members read case attachments"
  ON case_attachments FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Residents insert own case attachments"
  ON case_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND entry_id IN (
      SELECT id FROM case_entries WHERE resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Supervisor+ delete case attachments in tenant"
  ON case_attachments FOR DELETE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- Replace RLS policies on approval_requests with direct tenant_id checks
DROP POLICY IF EXISTS "Tenant members can read approval requests" ON approval_requests;
DROP POLICY IF EXISTS "Resident can create approval request for own entries" ON approval_requests;
DROP POLICY IF EXISTS "Supervisor can update approval requests in tenant" ON approval_requests;

CREATE POLICY "Tenant members read approval requests"
  ON approval_requests FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Residents create approval requests"
  ON approval_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND entry_id IN (
      SELECT id FROM case_entries WHERE resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Supervisor+ update approval requests"
  ON approval_requests FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- Replace RLS policies on one_time_purchases with direct tenant_id checks
DROP POLICY IF EXISTS "Users can read own purchases" ON one_time_purchases;
DROP POLICY IF EXISTS "Supervisor+ can read tenant purchases" ON one_time_purchases;
DROP POLICY IF EXISTS "Users can insert own purchases" ON one_time_purchases;
DROP POLICY IF EXISTS "Admin can update purchases" ON one_time_purchases;

CREATE POLICY "Users read own purchases"
  ON one_time_purchases FOR SELECT
  TO authenticated
  USING (
    resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisor+ read tenant purchases"
  ON one_time_purchases FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Users insert own purchases"
  ON one_time_purchases FOR INSERT
  TO authenticated
  WITH CHECK (
    resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
  );

CREATE POLICY "Admin update purchases"
  ON one_time_purchases FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  );
