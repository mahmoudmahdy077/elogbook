-- ============================================================================
-- 00011: Critical Schema Fixes
-- ============================================================================

-- ============================================================================
-- 1. Add missing UNIQUE constraint on approval_requests(entry_id, supervisor_id)
--    approve_case() and reject_case() use ON CONFLICT (entry_id, supervisor_id)
--    which requires this constraint.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_entry_supervisor_unique
  ON approval_requests(entry_id, supervisor_id);

-- ============================================================================
-- 2. Add CHECK constraints for enum-like columns
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'institutions_tier_check') THEN
    ALTER TABLE institutions ADD CONSTRAINT institutions_tier_check
      CHECK (tier IN ('free', 'premium', 'enterprise'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'one_time_purchases_status_check') THEN
    ALTER TABLE one_time_purchases ADD CONSTRAINT one_time_purchases_status_check
      CHECK (status IN ('pending', 'completed', 'failed', 'refunded'));
  END IF;
END $$;

-- ============================================================================
-- 3. Add compound indexes for critical query paths
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_case_entries_tenant_status
  ON case_entries(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_case_entries_tenant_resident_status
  ON case_entries(tenant_id, resident_id, status);

CREATE INDEX IF NOT EXISTS idx_case_entries_case_date
  ON case_entries(case_date);

CREATE INDEX IF NOT EXISTS idx_case_attachments_entry_id
  ON case_attachments(entry_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_gateway_subscription_id
  ON subscriptions(gateway_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status
  ON subscriptions(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
  ON audit_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_program_goals_tenant_resident
  ON program_goals(tenant_id, resident_id);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_id
  ON payments(tenant_id);

CREATE INDEX IF NOT EXISTS idx_payments_gateway_payment_intent_id
  ON payments(gateway_payment_intent_id);

-- ============================================================================
-- 4. Add soft-delete columns to critical tables
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE case_entries
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE case_templates
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ============================================================================
-- 5. Add stripe_price_id column to subscription_plans
-- ============================================================================

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

-- ============================================================================
-- 6. Fix cascading deletes: change case_entries.resident_id FK
--    from ON DELETE CASCADE to ON DELETE RESTRICT
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO v_constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'case_entries'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'resident_id'
    AND tc.table_schema = 'public';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE case_entries DROP CONSTRAINT %I',
      v_constraint_name
    );
    EXECUTE format(
      'ALTER TABLE case_entries ADD CONSTRAINT %I FOREIGN KEY (resident_id) REFERENCES profiles(id) ON DELETE RESTRICT',
      v_constraint_name
    );
  END IF;
END;
$$;

-- ============================================================================
-- 7. Case status state machine trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_case_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    CASE OLD.status
      WHEN 'draft' THEN
        IF NEW.status NOT IN ('draft', 'pending') THEN
          RAISE EXCEPTION 'Invalid status transition: draft -> %. Allowed: draft, pending', NEW.status;
        END IF;
      WHEN 'pending' THEN
        IF NEW.status NOT IN ('approved', 'rejected') THEN
          RAISE EXCEPTION 'Invalid status transition: pending -> %. Allowed: approved, rejected', NEW.status;
        END IF;
      WHEN 'approved' THEN
        RAISE EXCEPTION 'Invalid status transition: approved is immutable. No transitions allowed.';
      WHEN 'rejected' THEN
        IF NEW.status != 'draft' THEN
          RAISE EXCEPTION 'Invalid status transition: rejected -> %. Allowed: draft', NEW.status;
        END IF;
      ELSE
        RAISE EXCEPTION 'Unknown status: %', OLD.status;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_case_status_transition ON case_entries;
CREATE TRIGGER trg_enforce_case_status_transition
  BEFORE UPDATE ON case_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_case_status_transition();

-- ============================================================================
-- 8. Fix hash_patient_mrn() to use configurable salt with fallback
-- ============================================================================

CREATE OR REPLACE FUNCTION hash_patient_mrn(p_mrn TEXT, p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_salt TEXT;
BEGIN
  v_salt := COALESCE(
    current_setting('app.mrn_salt', true),
    'elogbook-mrn-salt-v1'
  );
  RETURN encode(digest(p_mrn || v_salt || p_tenant_id::text, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 9. Add stripe_event_id column to payments for webhook idempotency
-- ============================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_event_id TEXT UNIQUE;