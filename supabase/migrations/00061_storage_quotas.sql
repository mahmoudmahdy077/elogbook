-- ============================================================================
-- 00061_storage_quotas.sql
--
-- Phase 6 / P6.9
--
-- Adds per-plan storage quotas to subscription_plans and a derived
-- per-tenant usage view. The actual file-size enforcement is delegated
-- to Supabase Storage's bucket-level `file_size_limit` (see config.toml
-- and `case-attachments` bucket config).
--
-- Antivirus scanning is OUT OF SCOPE for P6.9. ClamAV / S3-AV would
-- require an external service to be deployed alongside the Supabase
-- stack; a follow-up phase may add it. The hook is documented here so
-- a future contributor knows exactly where to wire it.
-- ============================================================================

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS storage_quota_mb INTEGER NOT NULL DEFAULT 1024
  CHECK (storage_quota_mb > 0);

COMMENT ON COLUMN public.subscription_plans.storage_quota_mb IS
  'Maximum total attachment storage in MB allowed for tenants on this plan. Default 1GB. Enforced by the case-attachments bucket file_size_limit and a per-tenant usage check in the case-attachments INSERT policy.';

-- Seed sensible defaults for the canonical plans.
UPDATE public.subscription_plans SET storage_quota_mb = 256  WHERE slug = 'individual-free'  AND storage_quota_mb = 1024;
UPDATE public.subscription_plans SET storage_quota_mb = 1024 WHERE slug = 'individual-pro'   AND storage_quota_mb = 1024;
UPDATE public.subscription_plans SET storage_quota_mb = 5120 WHERE slug = 'institution-core'  AND storage_quota_mb = 1024;
UPDATE public.subscription_plans SET storage_quota_mb = 25600 WHERE slug = 'institution-pro'  AND storage_quota_mb = 1024;
UPDATE public.subscription_plans SET storage_quota_mb = 102400 WHERE slug = 'institution-enterprise' AND storage_quota_mb = 1024;

-- Per-tenant storage usage view (MB). Sums the size of every object
-- in the case-attachments bucket for the tenant. Recomputed on demand.
CREATE OR REPLACE VIEW public.tenant_storage_usage_mb AS
SELECT
  t.id   AS tenant_id,
  t.slug AS tenant_slug,
  COALESCE(SUM((s.metadata->>'size')::BIGINT), 0) / (1024 * 1024)::BIGINT AS used_mb,
  COALESCE(sp.storage_quota_mb, 1024) AS quota_mb
FROM public.tenants t
LEFT JOIN storage.objects s
  ON s.bucket_id = 'case-attachments'
  AND (s.metadata->>'tenant_id')::UUID = t.id
LEFT JOIN public.subscriptions sub
  ON sub.tenant_id = t.id
  AND sub.status IN ('active', 'trialing', 'past_due')
LEFT JOIN public.subscription_plans sp
  ON sp.id = sub.plan_id
GROUP BY t.id, t.slug, sp.storage_quota_mb;

COMMENT ON VIEW public.tenant_storage_usage_mb IS
  'Per-tenant storage usage (MB) vs. the active plan quota. Source of truth for the case-attachments upload quota check.';

-- Grant read access to authenticated users (admins, institution_admin,
-- director). Force RLS is not used on views; rely on table RLS + the
-- filter in the policy below.
GRANT SELECT ON public.tenant_storage_usage_mb TO authenticated;
