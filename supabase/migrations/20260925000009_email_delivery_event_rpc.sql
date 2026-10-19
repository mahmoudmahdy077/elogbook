BEGIN;

CREATE OR REPLACE FUNCTION public.record_email_delivery_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_message_id text,
  p_recipient_hmac text,
  p_recipients jsonb,
  p_occurred_at timestamptz
)
RETURNS TABLE (
  replayed boolean,
  tenant_id uuid,
  template_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
  v_scope_count bigint;
  v_tenant_id uuid;
  v_template_key text;
  v_recipient jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service-role webhook context required'
      USING ERRCODE = '42501';
  END IF;
  IF p_provider <> 'resend'
    OR p_provider_event_id !~ '^[A-Za-z0-9._:-]{1,200}$'
    OR p_event_type NOT IN ('accepted', 'delivered', 'hard_bounced', 'complained', 'unsubscribed')
    OR p_provider_message_id !~ '^[A-Za-z0-9._:-]{1,200}$'
    OR p_recipient_hmac !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_recipients) <> 'array'
    OR jsonb_array_length(p_recipients) < 1
    OR jsonb_array_length(p_recipients) > 100
  THEN
    RAISE EXCEPTION 'invalid email webhook event'
      USING ERRCODE = '22023';
  END IF;

  FOR v_recipient IN SELECT value FROM jsonb_array_elements(p_recipients)
  LOOP
    IF jsonb_typeof(v_recipient) <> 'object'
      OR v_recipient ->> 'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR v_recipient ->> 'recipient_hmac' !~ '^[0-9a-f]{64}$'
    THEN
      RAISE EXCEPTION 'invalid email webhook recipient'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO public.email_delivery_events (
    provider,
    provider_event_id,
    event_type,
    provider_message_id,
    recipient_hmac,
    occurred_at,
    metadata
  ) VALUES (
    p_provider,
    p_provider_event_id,
    p_event_type,
    p_provider_message_id,
    p_recipient_hmac,
    p_occurred_at,
    '{}'::jsonb
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN QUERY SELECT TRUE, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  UPDATE public.email_logs
  SET status = CASE p_event_type
    WHEN 'accepted' THEN 'sent'
    WHEN 'delivered' THEN 'delivered'
    WHEN 'hard_bounced' THEN 'bounced'
    WHEN 'complained' THEN 'complained'
    ELSE status
  END
  WHERE provider = p_provider
    AND provider_id = p_provider_message_id;

  IF p_event_type = 'unsubscribed' THEN
    WITH scope AS (
      SELECT DISTINCT queue.tenant_id, queue.template_key
      FROM public.email_logs AS log
      JOIN public.email_queue AS queue ON queue.id = log.queue_id
      WHERE log.provider_id = p_provider_message_id
    )
    SELECT count(*), min(tenant_id), min(template_key)
    INTO v_scope_count, v_tenant_id, v_template_key
    FROM scope;

    IF v_scope_count <> 1 THEN
      RAISE EXCEPTION 'email webhook tenant and template scope are ambiguous'
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_recipient IN SELECT value FROM jsonb_array_elements(p_recipients)
    LOOP
      INSERT INTO public.email_unsubscribe_preferences (
        scope_key,
        recipient_hmac,
        tenant_id,
        template_key
      ) VALUES (
        COALESCE(v_tenant_id::text, 'global') || ':' || (v_recipient ->> 'recipient_hmac') || ':' || v_template_key,
        v_recipient ->> 'recipient_hmac',
        v_tenant_id,
        v_template_key
      )
      ON CONFLICT (scope_key) DO NOTHING;
    END LOOP;
  ELSIF p_event_type IN ('hard_bounced', 'complained') THEN
    FOR v_recipient IN SELECT value FROM jsonb_array_elements(p_recipients)
    LOOP
      INSERT INTO public.email_suppressions (email, reason, tenant_id)
      VALUES (
        lower(btrim(v_recipient ->> 'email')),
        CASE p_event_type WHEN 'hard_bounced' THEN 'bounce' ELSE 'complaint' END,
        NULL
      )
      ON CONFLICT (email) DO UPDATE
      SET reason = EXCLUDED.reason;
    END LOOP;
  END IF;

  RETURN QUERY SELECT FALSE, v_tenant_id, v_template_key;
END;
$$;

REVOKE ALL ON FUNCTION public.record_email_delivery_event(text, text, text, text, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_delivery_event(text, text, text, text, text, jsonb, timestamptz)
  TO service_role;

COMMIT;
