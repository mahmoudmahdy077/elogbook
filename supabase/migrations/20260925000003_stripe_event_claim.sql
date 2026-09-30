DO $$
BEGIN
  IF to_regclass('public.stripe_events') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'claim_token'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN claim_token UUID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'claimed_at'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN claimed_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'attempt_count'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'last_error'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN last_error TEXT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'next_attempt_at'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN next_attempt_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'retryable'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN retryable BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'event_created'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN event_created BIGINT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'object_version'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN object_version BIGINT NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'mode'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN mode TEXT NOT NULL DEFAULT 'test';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'livemode'
  ) THEN
    ALTER TABLE public.stripe_events ADD COLUMN livemode BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'stripe_event_created'
    ) THEN
      ALTER TABLE public.subscriptions ADD COLUMN stripe_event_created BIGINT NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'stripe_object_version'
    ) THEN
      ALTER TABLE public.subscriptions ADD COLUMN stripe_object_version BIGINT NOT NULL DEFAULT 0;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'last_stripe_event_id'
    ) THEN
      ALTER TABLE public.subscriptions ADD COLUMN last_stripe_event_id TEXT;
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.stripe_events'::regclass
      AND conname = 'stripe_events_mode_check'
  ) THEN
    ALTER TABLE public.stripe_events
      ADD CONSTRAINT stripe_events_mode_check
      CHECK (mode IN ('test', 'live'));
  END IF;
END;
$$;

ALTER TABLE public.stripe_events DROP CONSTRAINT IF EXISTS stripe_events_status_check;

UPDATE public.stripe_events
SET processed = false,
    status = CASE
      WHEN COALESCE(processed, FALSE) THEN 'processed'
      WHEN COALESCE(status, 'received') IN ('received', 'pending') THEN 'pending'
      ELSE COALESCE(status, 'received')
    END,
    next_attempt_at = CASE WHEN COALESCE(processed, FALSE) THEN NULL ELSE COALESCE(next_attempt_at, now()) END,
    retryable = NOT COALESCE(processed, FALSE),
    mode = COALESCE(mode, 'test'),
    livemode = COALESCE(livemode, FALSE),
    event_created = COALESCE(event_created, 0),
    object_version = COALESCE(object_version, 0)
WHERE processed IS NULL
   OR status IS NULL
   OR next_attempt_at IS NULL
   OR mode IS NULL
   OR livemode IS NULL;

ALTER TABLE public.stripe_events
  ALTER COLUMN processed SET DEFAULT FALSE,
  ALTER COLUMN processed SET NOT NULL,
  ALTER COLUMN mode SET DEFAULT 'test',
  ALTER COLUMN mode SET NOT NULL,
  ALTER COLUMN livemode SET DEFAULT FALSE,
  ALTER COLUMN livemode SET NOT NULL,
  ALTER COLUMN retryable SET DEFAULT TRUE,
  ALTER COLUMN retryable SET NOT NULL,
  ALTER COLUMN attempt_count SET DEFAULT 0,
  ALTER COLUMN attempt_count SET NOT NULL,
  ALTER COLUMN event_created SET DEFAULT 0,
  ALTER COLUMN event_created SET NOT NULL,
  ALTER COLUMN object_version SET DEFAULT 0,
  ALTER COLUMN object_version SET NOT NULL;

ALTER TABLE public.stripe_events
  ADD CONSTRAINT stripe_events_status_check
  CHECK (status IN ('received', 'pending', 'processing', 'processed', 'failed'));

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('active', 'canceled', 'past_due', 'unpaid', 'trialing', 'incomplete', 'paused'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_stripe_events_claimable
  ON public.stripe_events(status, next_attempt_at, created_at)
  WHERE processed = false;

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_order
  ON public.subscriptions(gateway_subscription_id, stripe_event_created, stripe_object_version)
  WHERE gateway_subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_stripe_event(
  p_event_id TEXT,
  p_event_type TEXT,
  p_mode TEXT,
  p_livemode BOOLEAN,
  p_tenant_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_claim_token UUID := gen_random_uuid();
  v_event_created BIGINT := 0;
  v_object_version BIGINT := 0;
  v_row RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR char_length(p_event_id) < 1 OR char_length(p_event_id) > 255
     OR p_event_type IS NULL OR char_length(p_event_type) < 1 OR char_length(p_event_type) > 255
     OR p_mode IS NULL OR p_mode NOT IN ('test', 'live')
     OR p_livemode IS NULL THEN
    RAISE EXCEPTION 'invalid stripe event identity' USING ERRCODE = '22023';
  END IF;

  IF p_payload IS NOT NULL
     AND COALESCE(p_payload ->> 'event_created', '') ~ '^[0-9]{1,19}$' THEN
    v_event_created := (p_payload ->> 'event_created')::BIGINT;
  END IF;
  IF p_payload IS NOT NULL
     AND COALESCE(p_payload ->> 'object_version', '') ~ '^[0-9]{1,19}$' THEN
    v_object_version := (p_payload ->> 'object_version')::BIGINT;
  END IF;

  INSERT INTO public.stripe_events (
    stripe_event_id, event_type, mode, livemode, tenant_id, payload,
    processed, status, claim_token, claimed_at, attempt_count,
    next_attempt_at, retryable, event_created, object_version
  )
  VALUES (
    p_event_id, p_event_type, p_mode, p_livemode, p_tenant_id, p_payload,
    FALSE, 'pending', NULL, NULL, 0, now(), TRUE, v_event_created, v_object_version
  )
  ON CONFLICT (stripe_event_id) DO UPDATE
  SET event_type = EXCLUDED.event_type,
      mode = EXCLUDED.mode,
      livemode = EXCLUDED.livemode,
      tenant_id = COALESCE(EXCLUDED.tenant_id, stripe_events.tenant_id),
      payload = COALESCE(EXCLUDED.payload, stripe_events.payload)
  WHERE stripe_events.processed = FALSE
    AND stripe_events.event_type = EXCLUDED.event_type
    AND stripe_events.mode = EXCLUDED.mode
    AND stripe_events.livemode = EXCLUDED.livemode
    AND stripe_events.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id;

  UPDATE public.stripe_events
  SET status = 'processing',
      claim_token = v_claim_token,
      claimed_at = now(),
      attempt_count = attempt_count + 1,
      next_attempt_at = NULL,
      retryable = TRUE,
      failure_reason = NULL,
      last_error = NULL
  WHERE stripe_event_id = p_event_id
    AND processed = FALSE
    AND event_type = p_event_type
    AND mode = p_mode
    AND livemode = p_livemode
    AND tenant_id IS NOT DISTINCT FROM p_tenant_id
    AND (
      status = 'received'
      OR (
        status IN ('pending', 'failed')
        AND (
          status = 'pending'
          OR (retryable = TRUE AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
        )
      )
      OR (status = 'processing' AND claimed_at IS NOT NULL AND claimed_at < now() - INTERVAL '10 minutes')
    )
  RETURNING id, stripe_event_id, status, claim_token, attempt_count, next_attempt_at, retryable
  INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', TRUE,
      'status', v_row.status,
      'claim_token', v_row.claim_token,
      'attempt', v_row.attempt_count,
      'next_attempt_at', v_row.next_attempt_at,
      'retryable', v_row.retryable
    );
  END IF;

  SELECT status, processed, retryable, next_attempt_at, event_type, mode, livemode, tenant_id
  INTO v_row
  FROM public.stripe_events
  WHERE stripe_event_id = p_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', FALSE, 'status', 'missing');
  END IF;
  IF v_row.event_type <> p_event_type
     OR v_row.mode <> p_mode
     OR v_row.livemode <> p_livemode
     OR v_row.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RETURN jsonb_build_object('claimed', FALSE, 'status', 'identity_mismatch');
  END IF;
  RETURN jsonb_build_object(
    'claimed', FALSE,
    'status', v_row.status,
    'processed', v_row.processed,
    'retryable', v_row.retryable,
    'next_attempt_at', v_row.next_attempt_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_stripe_event_processed(
  p_event_id TEXT,
  p_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.stripe_events
  SET status = 'processed',
      processed = TRUE,
      processed_at = now(),
      claim_token = NULL,
      claimed_at = NULL,
      next_attempt_at = NULL,
      retryable = FALSE,
      failure_reason = NULL,
      last_error = NULL
  WHERE stripe_event_id = p_event_id
    AND claim_token = p_claim_token
    AND processed = FALSE
    AND status = 'processing';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_stripe_event_failed(
  p_event_id TEXT,
  p_claim_token UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.stripe_events
  SET status = 'failed',
      processed = FALSE,
      failure_reason = LEFT(COALESCE(p_reason, 'unknown'), 1000),
      last_error = LEFT(COALESCE(p_reason, 'unknown'), 1000),
      next_attempt_at = now() + make_interval(
        secs => LEAST(3600.0, 30.0 * power(2, GREATEST(attempt_count - 1, 0)))
      ),
      retryable = TRUE,
      claim_token = NULL,
      claimed_at = NULL
  WHERE stripe_event_id = p_event_id
    AND claim_token = p_claim_token
    AND processed = FALSE
    AND status = 'processing';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_event(TEXT, TEXT, TEXT, BOOLEAN, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_stripe_event_processed(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_stripe_event_failed(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(TEXT, TEXT, TEXT, BOOLEAN, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stripe_event_processed(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stripe_event_failed(TEXT, UUID, TEXT) TO service_role;
