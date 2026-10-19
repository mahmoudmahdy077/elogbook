BEGIN;

CREATE TABLE public.email_unsubscribe_preferences (
  scope_key text PRIMARY KEY,
  recipient_hmac text NOT NULL CHECK (recipient_hmac ~ '^[0-9a-f]{64}$'),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_key text NOT NULL CHECK (char_length(template_key) BETWEEN 1 AND 120),
  unsubscribed_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (char_length(scope_key) BETWEEN 1 AND 512)
);

CREATE INDEX email_unsubscribe_preferences_lookup_idx
  ON public.email_unsubscribe_preferences (recipient_hmac, template_key, tenant_id);

CREATE TABLE public.email_send_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL,
  queue_id uuid REFERENCES public.email_queue(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  template_key text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('resend', 'smtp')),
  phase text NOT NULL CHECK (phase IN ('started', 'accepted', 'rejected', 'retryable', 'configuration', 'ambiguous', 'suppressed')),
  provider_id text,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,120}$'),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX email_send_audit_attempt_idx ON public.email_send_audit (attempt_id, created_at);
CREATE INDEX email_send_audit_queue_idx ON public.email_send_audit (queue_id, created_at);

DROP TRIGGER IF EXISTS email_send_audit_no_update ON public.email_send_audit;
CREATE TRIGGER email_send_audit_no_update
  BEFORE UPDATE ON public.email_send_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_email_audit_mutation();

DROP TRIGGER IF EXISTS email_send_audit_no_delete ON public.email_send_audit;
CREATE TRIGGER email_send_audit_no_delete
  BEFORE DELETE ON public.email_send_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_email_audit_mutation();

ALTER TABLE public.email_unsubscribe_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribe_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_audit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_unsubscribe_preferences, public.email_send_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.email_unsubscribe_preferences TO service_role;
GRANT SELECT, INSERT ON public.email_send_audit TO service_role;

CREATE OR REPLACE FUNCTION public.reject_sensitive_email_queue_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  ALLOWED_PAYLOAD_KEYS CONSTANT text[] := ARRAY[
    'activity_count', 'case_url', 'contact_url', 'cta_url', 'dashboard_url',
    'onboarding_url', 'preheader', 'review_url', 'role'
  ];
BEGIN
  IF jsonb_typeof(NEW.payload) <> 'object'
    OR pg_column_size(NEW.payload) > 16384
    OR EXISTS (
      SELECT 1
      FROM jsonb_each(NEW.payload) AS entry
      WHERE NOT (entry.key = ANY(ALLOWED_PAYLOAD_KEYS))
        OR jsonb_typeof(entry.value) <> 'string'
    )
  THEN
    RAISE EXCEPTION 'email queue payload contains forbidden content or exceeds its limit'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_queue_reject_sensitive_payload ON public.email_queue;
CREATE TRIGGER email_queue_reject_sensitive_payload
  BEFORE INSERT OR UPDATE OF payload ON public.email_queue
  FOR EACH ROW EXECUTE FUNCTION public.reject_sensitive_email_queue_payload();

COMMIT;
