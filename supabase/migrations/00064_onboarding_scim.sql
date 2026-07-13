-- Migration 00064: Add onboarding flag + SCIM tokens
-- (merged from 00064_onboarding_flag.sql and 00064_scim_tokens.sql)

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.scim_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scim_tokens_tenant
  ON public.scim_tokens(tenant_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.scim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scim_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scim_tokens_admin ON public.scim_tokens;
CREATE POLICY scim_tokens_admin ON public.scim_tokens
  FOR ALL
  TO authenticated
  USING (public.current_role_global() = 'admin')
  WITH CHECK (public.current_role_global() = 'admin');

CREATE OR REPLACE FUNCTION public.hash_scim_token(p_token TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;
