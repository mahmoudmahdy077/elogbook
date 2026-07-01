-- ============================================================================
-- 00064_scim_tokens.sql
--
-- Phase 6 / P6.11
--
-- Per-tenant SCIM 2.0 bearer tokens used by the `scim` edge function
-- for automated user provisioning. Tokens are stored as SHA-256
-- hashes; the plaintext is only shown once at creation time.
--
-- Full SCIM 2.0 conformance (pagination, filtering, etag, /Groups,
-- /Schemas, /ServiceProviderConfig, /ResourceTypes, /Bulk, /Me) is
-- out of scope for Phase 6. This migration provides the auth surface
-- and the storage; the function provides /Users GET/POST/PATCH/DELETE.
-- ============================================================================

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

-- Only platform admins may read/write SCIM tokens. The scim edge
-- function uses the service role and bypasses RLS to authenticate
-- incoming requests.
DROP POLICY IF EXISTS scim_tokens_admin ON public.scim_tokens;
CREATE POLICY scim_tokens_admin ON public.scim_tokens
  FOR ALL
  TO authenticated
  USING (public.current_role_global() = 'admin')
  WITH CHECK (public.current_role_global() = 'admin');

-- Helper: SHA-256 hash a SCIM token for storage / lookup.
-- Implemented in plpgsql so it can be used from RPCs and tests.
CREATE OR REPLACE FUNCTION public.hash_scim_token(p_token TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT encode(digest(p_token, 'sha256'), 'hex')
$$;
