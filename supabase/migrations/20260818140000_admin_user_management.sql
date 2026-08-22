-- Migration: Comprehensive Admin User Management
-- Adds user status, custom plan management, and subscription control

-- 1. Add status column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
  CHECK (status IN ('active', 'pending', 'suspended', 'deactivated'));

-- 2. Add deactivation timestamp
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- 3. Add last_login_at for tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 4. Add invited_by to track who invited the user
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id);

-- 5. Create custom_plan_features table for granular feature control
CREATE TABLE IF NOT EXISTS custom_plan_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  feature_value JSONB NOT NULL DEFAULT 'true',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plan_id, feature_key)
);

-- 6. Add is_custom column to subscription_plans to distinguish admin-created plans
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;

-- 7. Add created_by to track which admin created the plan
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- 8. Create subscription_changes table for upgrade/downgrade audit trail
CREATE TABLE IF NOT EXISTS subscription_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  old_plan_id UUID REFERENCES subscription_plans(id),
  new_plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('upgrade', 'downgrade', 'cancel', 'reactivate', 'custom')),
  reason TEXT,
  changed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Add cancellation_reason to subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- 10. Add canceled_at to subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;

-- 11. Create tenant_settings table for tenant-level configuration
CREATE TABLE IF NOT EXISTS tenant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  branding JSONB DEFAULT '{}',
  notifications JSONB DEFAULT '{}',
  security JSONB DEFAULT '{}',
  features JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Add RLS policies for new tables
ALTER TABLE custom_plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

-- custom_plan_features: admin can manage, all can read
CREATE POLICY "Admin can manage custom plan features" ON custom_plan_features
  FOR ALL USING (
    get_user_role() IN ('institution_admin', 'admin')
  );

CREATE POLICY "All authenticated can read custom plan features" ON custom_plan_features
  FOR SELECT USING (true);

-- subscription_changes: admin can manage, all can read
CREATE POLICY "Admin can manage subscription changes" ON subscription_changes
  FOR ALL USING (
    get_user_role() IN ('institution_admin', 'admin')
  );

CREATE POLICY "All authenticated can read subscription changes" ON subscription_changes
  FOR SELECT USING (
    tenant_id = get_tenant_id()
  );

-- tenant_settings: admin can manage, tenant members can read
CREATE POLICY "Admin can manage tenant settings" ON tenant_settings
  FOR ALL USING (
    get_user_role() IN ('institution_admin', 'admin')
  );

CREATE POLICY "Tenant members can read tenant settings" ON tenant_settings
  FOR SELECT USING (
    tenant_id = get_tenant_id()
  );

-- 13. Create indexes
CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_status ON profiles(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_subscription_changes_tenant ON subscription_changes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_changes_created ON subscription_changes(created_at);
CREATE INDEX IF NOT EXISTS idx_custom_plan_features_plan ON custom_plan_features(plan_id);
