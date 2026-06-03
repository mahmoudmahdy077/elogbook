-- ============================================================================
-- Row-Level Security Policies
-- Hierarchy: resident → supervisor → director → institution_admin → admin
-- Higher roles inherit lower-role permissions.
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE one_time_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE resident_ai_toggle ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_gateway_config ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Helper Functions
-- ============================================================================

CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
BEGIN
  RETURN (auth.jwt() -> 'app_metadata' ->> 'user_role');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- institutions
-- ============================================================================

CREATE POLICY "Institutions are readable by all authenticated"
  ON institutions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can insert institutions"
  ON institutions FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Admin can update institutions"
  ON institutions FOR UPDATE
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ============================================================================
-- tenants
-- ============================================================================

CREATE POLICY "Users can read own tenant"
  ON tenants FOR SELECT
  TO authenticated
  USING (id = get_tenant_id());

CREATE POLICY "Admin can manage all tenants"
  ON tenants FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ============================================================================
-- profiles
-- ============================================================================

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Supervisor+ can read tenant profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Any authenticated user can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Supervisor+ can update resident profiles in tenant"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Admin can delete profiles"
  ON profiles FOR DELETE
  TO authenticated
  USING (get_user_role() IN ('institution_admin', 'admin'));

-- ============================================================================
-- case_templates
-- ============================================================================

CREATE POLICY "Tenant members can read templates"
  ON case_templates FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Director+ can create templates"
  ON case_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can update templates"
  ON case_templates FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can delete templates"
  ON case_templates FOR DELETE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

-- ============================================================================
-- case_entries
-- ============================================================================

CREATE POLICY "Resident reads own entries"
  ON case_entries FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisor+ reads all tenant entries"
  ON case_entries FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Authenticated users can insert own entries"
  ON case_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Resident updates own draft entries"
  ON case_entries FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  );

CREATE POLICY "Resident submits own entries (draft→pending)"
  ON case_entries FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status IN ('draft', 'pending')
  );

CREATE POLICY "Supervisor can update any entry in tenant"
  ON case_entries FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- ============================================================================
-- case_attachments
-- ============================================================================

CREATE POLICY "Users read attachments on own tenant entries"
  ON case_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM case_entries ce
      WHERE ce.id = case_attachments.entry_id
      AND ce.tenant_id = get_tenant_id()
    )
  );

CREATE POLICY "Users can insert attachments for own entries"
  ON case_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_entries ce
      WHERE ce.id = case_attachments.entry_id
      AND ce.tenant_id = get_tenant_id()
      AND ce.resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Supervisor+ can delete attachments in tenant"
  ON case_attachments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM case_entries ce
      WHERE ce.id = case_attachments.entry_id
      AND ce.tenant_id = get_tenant_id()
    )
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- ============================================================================
-- approval_requests
-- ============================================================================

CREATE POLICY "Tenant members can read approval requests"
  ON approval_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM case_entries ce
      WHERE ce.id = approval_requests.entry_id
      AND ce.tenant_id = get_tenant_id()
    )
  );

CREATE POLICY "Resident can create approval request for own entries"
  ON approval_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_entries ce
      WHERE ce.id = approval_requests.entry_id
      AND ce.tenant_id = get_tenant_id()
      AND ce.resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "Supervisor can update approval requests in tenant"
  ON approval_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM case_entries ce
      WHERE ce.id = approval_requests.entry_id
      AND ce.tenant_id = get_tenant_id()
    )
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM case_entries ce
      WHERE ce.id = approval_requests.entry_id
      AND ce.tenant_id = get_tenant_id()
    )
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- ============================================================================
-- audit_logs
-- ============================================================================

CREATE POLICY "Admin roles can read audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Any authenticated user can insert audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_tenant_id());

-- ============================================================================
-- program_goals
-- ============================================================================

CREATE POLICY "Tenant members can read program goals"
  ON program_goals FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Director+ can create program goals"
  ON program_goals FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can update program goals"
  ON program_goals FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can delete program goals"
  ON program_goals FOR DELETE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

-- ============================================================================
-- goal_progress
-- ============================================================================

CREATE POLICY "Tenant members can read goal progress"
  ON goal_progress FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM program_goals pg
      WHERE pg.id = goal_progress.goal_id
      AND pg.tenant_id = get_tenant_id()
    )
  );

CREATE POLICY "Director+ can insert goal progress"
  ON goal_progress FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM program_goals pg
      WHERE pg.id = goal_progress.goal_id
      AND pg.tenant_id = get_tenant_id()
    )
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can update goal progress"
  ON goal_progress FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM program_goals pg
      WHERE pg.id = goal_progress.goal_id
      AND pg.tenant_id = get_tenant_id()
    )
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM program_goals pg
      WHERE pg.id = goal_progress.goal_id
      AND pg.tenant_id = get_tenant_id()
    )
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

-- ============================================================================
-- subscription_plans
-- ============================================================================

CREATE POLICY "All authenticated users can read subscription plans"
  ON subscription_plans FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin can manage subscription plans"
  ON subscription_plans FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ============================================================================
-- subscriptions
-- ============================================================================

CREATE POLICY "Tenant members can read own subscription"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Admin can manage subscriptions"
  ON subscriptions FOR ALL
  TO authenticated
  USING (get_user_role() IN ('institution_admin', 'admin'))
  WITH CHECK (get_user_role() IN ('institution_admin', 'admin'));

-- ============================================================================
-- payments
-- ============================================================================

CREATE POLICY "Tenant members can read own payment history"
  ON payments FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Admin can manage payments"
  ON payments FOR ALL
  TO authenticated
  USING (get_user_role() IN ('institution_admin', 'admin'))
  WITH CHECK (get_user_role() IN ('institution_admin', 'admin'));

-- ============================================================================
-- one_time_purchases
-- ============================================================================

CREATE POLICY "Users can read own purchases"
  ON one_time_purchases FOR SELECT
  TO authenticated
  USING (
    resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisor+ can read tenant purchases"
  ON one_time_purchases FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = one_time_purchases.resident_id
      AND p.tenant_id = get_tenant_id()
    )
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Users can insert own purchases"
  ON one_time_purchases FOR INSERT
  TO authenticated
  WITH CHECK (
    resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Admin can update purchases"
  ON one_time_purchases FOR UPDATE
  TO authenticated
  USING (get_user_role() IN ('institution_admin', 'admin'))
  WITH CHECK (get_user_role() IN ('institution_admin', 'admin'));

-- ============================================================================
-- ai_config
-- ============================================================================

CREATE POLICY "Admin only can read AI config"
  ON ai_config FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  );

CREATE POLICY "Admin only can manage AI config"
  ON ai_config FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  );

CREATE POLICY "Admin only can update AI config"
  ON ai_config FOR UPDATE
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
-- resident_ai_toggle
-- ============================================================================

CREATE POLICY "Tenant members can read AI toggle status"
  ON resident_ai_toggle FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

CREATE POLICY "Admin can manage AI toggle"
  ON resident_ai_toggle FOR ALL
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
-- ai_query_logs
-- ============================================================================

CREATE POLICY "Resident reads own AI query logs"
  ON ai_query_logs FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisor+ reads all tenant AI query logs"
  ON ai_query_logs FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "System can insert AI query logs"
  ON ai_query_logs FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_tenant_id());

-- ============================================================================
-- payment_gateway_config
-- ============================================================================

CREATE POLICY "Admin and director can read payment gateway config"
  ON payment_gateway_config FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Admin can manage payment gateway config"
  ON payment_gateway_config FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  );

CREATE POLICY "Admin can update payment gateway config"
  ON payment_gateway_config FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  );
