BEGIN;

DROP FUNCTION public.claim_email_queue(integer, integer, uuid);

CREATE OR REPLACE FUNCTION public.claim_email_queue(
  p_limit integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 3600,
  p_lease_token uuid DEFAULT gen_random_uuid()
)
RETURNS TABLE (
  id uuid,
  template_key text,
  to_email text,
  to_name text,
  tenant_id uuid,
  payload jsonb,
  attempts integer,
  priority integer,
  created_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_lease_duration interval := LEAST(
    GREATEST(COALESCE(p_lease_seconds, 3600), 60),
    3600
  ) * interval '1 second';
  v_token uuid := COALESCE(p_lease_token, gen_random_uuid());
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service-role operations context required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT queue.id
    FROM public.email_queue AS queue
    WHERE (
      queue.status IN ('pending', 'retry')
      AND queue.next_retry_at <= v_now
    ) OR (
      queue.status = 'processing'
      AND (queue.lease_expires_at IS NULL OR queue.lease_expires_at <= v_now)
    )
    ORDER BY queue.priority DESC, queue.next_retry_at, queue.created_at, queue.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_queue AS queue
  SET status = 'processing',
      lease_token = v_token,
      lease_expires_at = v_now + v_lease_duration,
      claimed_at = v_now
  FROM candidates
  WHERE queue.id = candidates.id
  RETURNING
    queue.id,
    queue.template_key,
    queue.to_email,
    queue.to_name,
    queue.tenant_id,
    queue.payload,
    queue.attempts,
    queue.priority,
    queue.created_at,
    queue.lease_token,
    queue.lease_expires_at;
END;
$$;

ALTER TABLE public.email_logs
  DROP CONSTRAINT IF EXISTS email_logs_status_check;

ALTER TABLE public.email_logs
  ADD CONSTRAINT email_logs_status_check
  CHECK (status IN ('sent', 'delivered', 'failed', 'suppressed', 'bounced', 'complained'));

REVOKE ALL ON FUNCTION public.claim_email_queue(integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_queue(integer, integer, uuid)
  TO service_role;

COMMIT;
