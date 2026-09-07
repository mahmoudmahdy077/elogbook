-- ============================================================================
-- 20260907000003_tenant_lifecycle_status.sql (T18)
--
-- Tenant lifecycle state: active (default) / suspended / archived.
-- Suspension is enforced at the application guard layer
-- (requireTenantAdmin denies non-active tenants) and surfaced in the
-- platform console. Row-level suspension across every tenant table
-- (direct REST/RPC/Storage) is T18-full work; this migration provides
-- the state column it will predicate on. History is never rewritten.
-- ============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended', 'archived'));
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS status_reason TEXT;
