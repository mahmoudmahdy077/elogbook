-- ============================================================================
-- Lapsed Tenant Write Guard
-- Prevents new case creation when an institutional subscription has lapsed.
-- ============================================================================

-- 1. Block INSERT for residents of lapsed tenants (supervisors+ exempt)
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

-- 2. Use trigger function for UPDATE guard (cannot use OLD in WITH CHECK)
-- Trigger will block draft->pending for lapsed tenants

CREATE OR REPLACE FUNCTION block_lapsed_tenant_submit()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow supervisors+ to bypass
  IF get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN NEW;
  END IF;

  -- Only check draft -> pending transitions
  IF OLD.status = 'draft' AND NEW.status = 'pending' THEN
    IF EXISTS (
      SELECT 1 FROM subscriptions
      WHERE subscriptions.tenant_id = NEW.tenant_id
        AND subscriptions.status IN ('past_due', 'unpaid')
    ) THEN
      RAISE EXCEPTION 'Cannot submit case for approval: subscription lapsed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_block_lapsed_tenant_submit ON case_entries;
CREATE TRIGGER trg_block_lapsed_tenant_submit
  BEFORE UPDATE ON case_entries
  FOR EACH ROW
  EXECUTE FUNCTION block_lapsed_tenant_submit();
