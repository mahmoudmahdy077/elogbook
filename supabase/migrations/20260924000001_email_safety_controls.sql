CREATE TABLE public.email_system_settings (
  id text PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  enabled boolean NOT NULL DEFAULT true,
  platform_marketing_enabled boolean NOT NULL DEFAULT false,
  tenant_mail_enabled boolean NOT NULL DEFAULT false,
  default_reply_to_email text,
  tenant_campaign_recipient_limit integer NOT NULL DEFAULT 500 CHECK (tenant_campaign_recipient_limit > 0),
  tenant_daily_recipient_limit integer NOT NULL DEFAULT 2000 CHECK (tenant_daily_recipient_limit > 0),
  platform_campaign_recipient_limit integer NOT NULL DEFAULT 50000 CHECK (platform_campaign_recipient_limit > 0),
  platform_daily_recipient_limit integer NOT NULL DEFAULT 100000 CHECK (platform_daily_recipient_limit > 0),
  queue_retention_days integer NOT NULL DEFAULT 30 CHECK (queue_retention_days BETWEEN 1 AND 365),
  log_retention_days integer NOT NULL DEFAULT 90 CHECK (log_retention_days BETWEEN 30 AND 730),
  audit_retention_days integer NOT NULL DEFAULT 180 CHECK (audit_retention_days BETWEEN 90 AND 3650),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_delivery_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('global', 'platform', 'tenant', 'domain')),
  scope_id uuid,
  message_class text CHECK (message_class IN ('essential_transactional', 'security_transactional', 'platform_marketing', 'tenant_operational')),
  enabled boolean NOT NULL DEFAULT true,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_type = 'tenant' AND scope_id IS NOT NULL) OR scope_type <> 'tenant')
);

CREATE TABLE public.email_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  provider_message_id text,
  recipient_hmac text,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE public.email_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('unsubscribe', 'confirmation', 'invitation')),
  subject_hmac text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_test_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform', 'tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  recipient_hmac text NOT NULL,
  masked_address text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tenant' AND tenant_id IS NOT NULL) OR scope = 'platform')
);

CREATE TABLE public.email_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role text,
  scope text NOT NULL CHECK (scope IN ('platform', 'tenant', 'system')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'denied')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX email_delivery_controls_scope_unique
  ON public.email_delivery_controls (scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(message_class, ''));
CREATE INDEX email_delivery_events_occurred_idx ON public.email_delivery_events (occurred_at DESC);
CREATE INDEX email_delivery_events_message_idx ON public.email_delivery_events (provider_message_id);
CREATE INDEX email_action_tokens_expiry_idx ON public.email_action_tokens (expires_at);
CREATE INDEX email_action_tokens_subject_idx ON public.email_action_tokens (subject_hmac);
CREATE UNIQUE INDEX email_test_recipients_scope_hmac_unique
  ON public.email_test_recipients (scope, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), recipient_hmac);
CREATE INDEX email_admin_audit_scope_idx ON public.email_admin_audit (scope, tenant_id, created_at DESC);
CREATE INDEX email_admin_audit_resource_idx ON public.email_admin_audit (resource_type, resource_id, created_at DESC);

INSERT INTO public.email_system_settings (id) VALUES ('global') ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reject_email_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'email_admin_audit is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_email_audit_sensitive_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.metadata ?| ARRAY[
    'email', 'to', 'to_email', 'recipient', 'recipient_email', 'payload',
    'render_context', 'raw_body', 'provider_body', 'authorization', 'token'
  ] THEN
    RAISE EXCEPTION 'email_admin_audit metadata contains a forbidden recipient or secret field'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER email_admin_audit_no_update
  BEFORE UPDATE ON public.email_admin_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_email_audit_mutation();

CREATE TRIGGER email_admin_audit_no_delete
  BEFORE DELETE ON public.email_admin_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_email_audit_mutation();

CREATE TRIGGER email_admin_audit_safe_metadata
  BEFORE INSERT ON public.email_admin_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_email_audit_sensitive_metadata();

ALTER TABLE public.email_system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_action_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_test_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_admin_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.email_system_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_controls FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_action_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_test_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_admin_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_system_settings, public.email_delivery_controls, public.email_delivery_events, public.email_action_tokens, public.email_test_recipients, public.email_admin_audit FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.email_system_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_delivery_controls TO service_role;
GRANT SELECT, INSERT ON public.email_delivery_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.email_action_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_test_recipients TO service_role;
GRANT SELECT, INSERT ON public.email_admin_audit TO service_role;
