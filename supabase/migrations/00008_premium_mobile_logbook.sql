-- ============================================================================
-- Premium Mobile Logbook: Compliance, AI Safety, Data Residency
-- ============================================================================

-- ============================================================================
-- 1. Tenant compliance and data residency fields
-- ============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'us-east-1',
  ADD COLUMN IF NOT EXISTS data_retention_days INTEGER DEFAULT 2555,
  ADD COLUMN IF NOT EXISTS consent_required BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS compliance_frameworks TEXT[] DEFAULT '{}';

-- ============================================================================
-- 2. AI query log safety tracking fields
-- ============================================================================

ALTER TABLE ai_query_logs
  ADD COLUMN IF NOT EXISTS disclaimer_rendered BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS response_format TEXT DEFAULT 'text' CHECK (response_format IN ('text', 'stream')),
  ADD COLUMN IF NOT EXISTS safety_flags TEXT[] DEFAULT '{}';

-- ============================================================================
-- 3. Apply updated_at trigger to new tables from 00007 if not already applied
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at' AND tgrelid = 'accreditation_frameworks'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at BEFORE UPDATE ON accreditation_frameworks
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at' AND tgrelid = 'institution_billing'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at BEFORE UPDATE ON institution_billing
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;
