-- ============================================================================
-- 20260907000002_platform_authority.sql (T17)
--
-- Platform operator registry + scoped support grants + reserved slugs.
-- Replaces the never-built `admin_tenants` join table referenced by a
-- stale comment in apps/web/lib/supabase/auth.ts (F10): cross-tenant
-- access requires an explicit expiring platform_tenant_access grant, and
-- platform authority NEVER implies clinical-record access.
--
-- Rules enforced here:
--  1. platform_admins is an explicit registry keyed to auth.users.id.
--     Nothing auto-promotes: no trigger, no backfill, no role mapping.
--  2. RLS is enabled with NO policies: authenticated/anon cannot read or
--     write either table; service_role (manager/API server-side) can.
--  3. Grants expire (expires_at > created_at enforced) and revoke via
--     revoked_at; expiry/revocation checks belong to readers (API).
--  4. Reserved slugs cannot become tenants (fails loudly if violated).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  granted_by UUID REFERENCES auth.users(id),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies: deny direct reads/writes for anon/authenticated by default.
-- Server-side code uses the service-role client (bypasses RLS by design).

CREATE TABLE IF NOT EXISTS public.platform_tenant_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id UUID NOT NULL REFERENCES public.platform_admins(user_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'metadata:read'
    CHECK (scope IN ('metadata:read', 'support:read', 'support:write')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_tenant_access_expiry_valid CHECK (expires_at > created_at)
);

ALTER TABLE public.platform_tenant_access ENABLE ROW LEVEL SECURITY;
-- No policies: same deny-by-default posture as platform_admins.

-- Reserved slugs: /platform is the operator area, never a tenant.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(slug, ', ') INTO v_bad FROM public.tenants
  WHERE slug IN ('platform','api','auth','setup','update','admin','login','signup','pricing','contact','dashboard','mfa','onboarding');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'reserved tenant slugs already in use: %', v_bad;
  END IF;
END $$;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_slug_reserved CHECK (
    slug NOT IN ('platform','api','auth','setup','update','admin','login','signup','pricing','contact','dashboard','mfa','onboarding')
  );
