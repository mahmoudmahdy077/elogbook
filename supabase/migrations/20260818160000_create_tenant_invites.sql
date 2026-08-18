-- Create tenant_invites table for invite system
CREATE TABLE IF NOT EXISTS tenant_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin')) DEFAULT 'resident',
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'expired')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

-- Add RLS policies
ALTER TABLE tenant_invites ENABLE ROW LEVEL SECURITY;

-- Admins can manage invites for their tenant
CREATE POLICY "Admins can manage invites"
  ON tenant_invites FOR ALL
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  );

-- Residents can view their own invites
CREATE POLICY "Users can view their own invites"
  ON tenant_invites FOR SELECT
  TO authenticated
  USING (
    email = (SELECT email FROM profiles WHERE user_id = auth.uid())
  );

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tenant_invites_email ON tenant_invites(email);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant ON tenant_invites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_status ON tenant_invites(status);
