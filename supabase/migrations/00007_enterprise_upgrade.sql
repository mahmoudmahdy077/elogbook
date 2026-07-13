-- ============================================================================
-- Enterprise Upgrade: De-identification, Accreditation, Signatures, Billing
-- ============================================================================

-- ============================================================================
-- 1. De-identification fields for case_entries
-- ============================================================================

ALTER TABLE case_entries
  ADD COLUMN IF NOT EXISTS patient_age_years INTEGER,
  ADD COLUMN IF NOT EXISTS patient_hash TEXT,
  ADD COLUMN IF NOT EXISTS accreditation_mappings JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS is_deidentified BOOLEAN DEFAULT TRUE;

ALTER TABLE case_entries
  ALTER COLUMN patient_mrn DROP NOT NULL,
  ALTER COLUMN patient_dob DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_case_entries_tenant_patient_hash
  ON case_entries(tenant_id, patient_hash);

-- ============================================================================
-- 2. Accreditation frameworks
-- ============================================================================

CREATE TABLE IF NOT EXISTS accreditation_frameworks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  framework_type TEXT NOT NULL CHECK (framework_type IN ('acgme', 'scfhs', 'gmc', 'canmeds', 'custom')),
  milestones JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accreditation_frameworks_tenant
  ON accreditation_frameworks(tenant_id);

-- ============================================================================
-- 3. Attachment signatures
-- ============================================================================

CREATE TABLE IF NOT EXISTS attachment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES case_attachments(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  signature_hash TEXT NOT NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('camera_hash', 'manual_hash', 'device_signature')),
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachment_signatures_tenant
  ON attachment_signatures(tenant_id);

CREATE INDEX IF NOT EXISTS idx_attachment_signatures_attachment
  ON attachment_signatures(attachment_id);

-- ============================================================================
-- 4. Institution billing
-- ============================================================================

CREATE TABLE IF NOT EXISTS institution_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  active_residents INTEGER NOT NULL DEFAULT 0,
  base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  per_resident_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'canceled')) DEFAULT 'draft',
  invoice_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, billing_period_start)
);

CREATE INDEX IF NOT EXISTS idx_institution_billing_tenant
  ON institution_billing(tenant_id);

-- Enable RLS on enterprise tables
ALTER TABLE accreditation_frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_billing ENABLE ROW LEVEL SECURITY;

-- RLS policies for accreditation_frameworks
CREATE POLICY "Tenant members can read accreditation frameworks"
  ON accreditation_frameworks FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Director+ can create accreditation frameworks"
  ON accreditation_frameworks FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can update accreditation frameworks"
  ON accreditation_frameworks FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can delete accreditation frameworks"
  ON accreditation_frameworks FOR DELETE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

-- RLS policies for attachment_signatures
CREATE POLICY "Tenant members can read attachment signatures"
  ON attachment_signatures FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Users can insert signature for own profile"
  ON attachment_signatures FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

-- RLS policies for institution_billing
CREATE POLICY "Admin roles can read institution billing"
  ON institution_billing FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Institution admin+ can manage institution billing"
  ON institution_billing FOR ALL
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  );

-- ============================================================================
-- 5. Helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION hash_patient_mrn(p_mrn TEXT, p_tenant_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN encode(digest(p_mrn || 'elogbook-mrn-salt-v1' || p_tenant_id::text, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION calculate_age_at_procedure(p_dob DATE, p_procedure_date DATE)
RETURNS INTEGER AS $$
BEGIN
  RETURN DATE_PART('year', AGE(p_procedure_date, p_dob))::INTEGER;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 6. Triggers for new tables
-- ============================================================================

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON accreditation_frameworks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON institution_billing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
