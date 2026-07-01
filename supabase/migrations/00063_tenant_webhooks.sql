-- ============================================================================
-- 00063_tenant_webhooks.sql
--
-- Phase 6 / P6.10
--
-- Per-tenant webhook subscriptions for case/approval events. Each row
-- registers a URL, a list of event types, and a signing secret used to
-- HMAC-SHA256 the outbound payload. The `dispatch-webhook` edge function
-- reads this table to know where to POST.
--
-- Full delivery (retry, DLQ, per-event replay) is product-level work
-- and lives outside Phase 6. This migration provides the schema; the
-- edge function provides the wiring.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL CHECK (cardinality(events) > 0),
  secret TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_webhooks_url_https CHECK (url ~* '^https?://')
);

CREATE INDEX IF NOT EXISTS idx_tenant_webhooks_tenant
  ON public.tenant_webhooks(tenant_id)
  WHERE is_active = true;

ALTER TABLE public.tenant_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_webhooks FORCE ROW LEVEL SECURITY;

-- Tenant admins (institution_admin / director / admin) may manage
-- their own webhooks; the dispatch function uses the service role.
DROP POLICY IF EXISTS tenant_webhooks_admin ON public.tenant_webhooks;
CREATE POLICY tenant_webhooks_admin ON public.tenant_webhooks
  FOR ALL
  TO authenticated
  USING (
    public.current_role_in_tenant(tenant_id, ARRAY['director', 'institution_admin'])
    OR public.current_role_global() = 'admin'
  )
  WITH CHECK (
    public.current_role_in_tenant(tenant_id, ARRAY['director', 'institution_admin'])
    OR public.current_role_global() = 'admin'
  );

-- Delivery log: one row per attempted dispatch. Useful for debugging
-- failed deliveries and for the audit trail.
CREATE TABLE IF NOT EXISTS public.tenant_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES public.tenant_webhooks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status_code INTEGER,
  request_body TEXT,
  response_body TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  succeeded BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_tenant_webhook_deliveries_webhook
  ON public.tenant_webhook_deliveries(webhook_id, attempted_at DESC);

ALTER TABLE public.tenant_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_webhook_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_webhook_deliveries_read ON public.tenant_webhook_deliveries;
CREATE POLICY tenant_webhook_deliveries_read ON public.tenant_webhook_deliveries
  FOR SELECT
  TO authenticated
  USING (
    public.current_role_in_tenant(tenant_id, ARRAY['director', 'institution_admin'])
    OR public.current_role_global() = 'admin'
  );

-- updated_at trigger on tenant_webhooks
DROP TRIGGER IF EXISTS tenant_webhooks_touch ON public.tenant_webhooks;
CREATE TRIGGER tenant_webhooks_touch
  BEFORE UPDATE ON public.tenant_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
