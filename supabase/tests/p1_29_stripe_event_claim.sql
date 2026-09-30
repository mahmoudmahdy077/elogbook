BEGIN;
SELECT plan(17);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'claim_token'
  ),
  'Stripe event claim token exists'
);
SELECT ok(
  to_regprocedure('public.claim_stripe_event(text,text,text,boolean,uuid,jsonb)') IS NOT NULL,
  'atomic Stripe event claim RPC exists'
);
SELECT ok(
  to_regprocedure('public.mark_stripe_event_processed(text,uuid)') IS NOT NULL,
  'token-guarded completion RPC exists'
);
SELECT ok(
  to_regprocedure('public.mark_stripe_event_failed(text,uuid,text)') IS NOT NULL,
  'token-guarded failure RPC exists'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_stripe_events_claimable'
  ),
  'claimable Stripe events are indexed'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.claim_stripe_event(text,text,text,boolean,uuid,jsonb)', 'EXECUTE'),
  'anonymous callers cannot claim Stripe events'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'mode'
  ),
  'Stripe event mode is persisted for replay validation'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'livemode'
  ),
  'Stripe event live mode is persisted for replay validation'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'next_attempt_at'
  ),
  'Stripe event retry time is persisted'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'retryable'
  ),
  'Stripe event retryability is persisted'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'event_created'
  ),
  'Stripe event creation order is persisted'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_events' AND column_name = 'object_version'
  ),
  'Stripe object version order is persisted'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'stripe_event_created'
  ),
  'Subscription provider event order is persisted'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'stripe_object_version'
  ),
  'Subscription object version order is persisted'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_subscriptions_provider_order'
  ),
  'Subscription provider ordering index exists'
);
SELECT ok(
  pg_get_functiondef('public.mark_stripe_event_failed(text,uuid,text)'::regprocedure) LIKE '%make_interval%'
    AND pg_get_functiondef('public.mark_stripe_event_failed(text,uuid,text)'::regprocedure) LIKE '%next_attempt_at%',
  'Stripe failures receive bounded backoff'
);
SELECT ok(
  pg_get_functiondef('public.claim_stripe_event(text,text,text,boolean,uuid,jsonb)'::regprocedure) LIKE '%identity_mismatch%',
  'Stripe event identity mismatch is not claimable across tenants or modes'
);

ROLLBACK;
