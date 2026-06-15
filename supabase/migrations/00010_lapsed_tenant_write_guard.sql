-- ============================================================================
-- Lapsed Tenant Write Guard
-- Prevents new case creation when an institutional subscription has lapsed.
-- ============================================================================

CREATE POLICY no_inserts_for_lapsed_tenants
  ON case_entries
  FOR INSERT
  WITH CHECK (
    NOT EXISTS (
      SELECT 1
      FROM subscriptions
      WHERE subscriptions.tenant_id = case_entries.tenant_id
        AND subscriptions.status IN ('past_due', 'unpaid')
    )
  );

CREATE POLICY no_submit_for_lapsed_tenants
  ON case_entries
  FOR UPDATE
  USING (true)
  WITH CHECK (
    NOT (
      OLD.status = 'draft'
      AND case_entries.status = 'pending'
      AND EXISTS (
        SELECT 1
        FROM subscriptions
        WHERE subscriptions.tenant_id = case_entries.tenant_id
          AND subscriptions.status IN ('past_due', 'unpaid')
      )
    )
  );
