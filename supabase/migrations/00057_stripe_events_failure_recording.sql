-- ============================================================================
-- 00057_stripe_events_failure_recording.sql
--
-- Phase 2 / P2.11
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stripe_events' AND column_name='status') THEN
    ALTER TABLE public.stripe_events ADD COLUMN status TEXT NOT NULL DEFAULT 'received'
      CHECK (status IN ('received', 'processed', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stripe_events' AND column_name='failure_reason') THEN
    ALTER TABLE public.stripe_events ADD COLUMN failure_reason TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stripe_events' AND column_name='tenant_id') THEN
    ALTER TABLE public.stripe_events ADD COLUMN tenant_id UUID REFERENCES public.tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stripe_events' AND column_name='payload') THEN
    ALTER TABLE public.stripe_events ADD COLUMN payload JSONB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stripe_events' AND column_name='signature_valid') THEN
    ALTER TABLE public.stripe_events ADD COLUMN signature_valid BOOLEAN;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stripe_events_status_failed
  ON public.stripe_events(status, created_at)
  WHERE status = 'failed';

-- Helper: mark a stripe event as failed
CREATE OR REPLACE FUNCTION public.mark_stripe_event_failed(
  p_event_id TEXT,
  p_reason TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.stripe_events
     SET status = 'failed',
         failure_reason = p_reason
   WHERE stripe_event_id = p_event_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_stripe_event_failed FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_stripe_event_failed TO service_role;
