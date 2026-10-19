BEGIN;
SELECT plan(14);

SELECT has_function(
  'public',
  'claim_email_queue',
  ARRAY['integer', 'integer', 'uuid'],
  'atomic email queue claim exists'
);
SELECT has_column('public', 'email_queue', 'lease_token', 'queue rows carry a lease token');
SELECT has_column('public', 'email_queue', 'lease_expires_at', 'queue rows carry a lease deadline');
SELECT has_column('public', 'email_queue', 'claimed_at', 'queue rows carry a claim timestamp');

INSERT INTO public.email_queue (id, template_key, to_email, payload)
VALUES (
  '00000000-0000-4000-8000-000000000025',
  'digest.weekly',
  'claim-test@example.com',
  '{}'::jsonb
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

SELECT is(
  (SELECT count(*) FROM public.claim_email_queue(10, 300, '10000000-0000-4000-8000-000000000001'::uuid)),
  1::bigint,
  'first worker claims the pending row'
);
SELECT is(
  (SELECT status FROM public.email_queue WHERE id = '00000000-0000-4000-8000-000000000025'),
  'processing',
  'claimed row enters processing state'
);
SELECT is(
  (SELECT lease_token FROM public.email_queue WHERE id = '00000000-0000-4000-8000-000000000025'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'claim stores the worker lease token'
);
SELECT is(
  (SELECT count(*) FROM public.claim_email_queue(10, 300, '10000000-0000-4000-8000-000000000002'::uuid)),
  0::bigint,
  'second worker cannot claim a live lease'
);

RESET ROLE;
UPDATE public.email_queue
SET lease_expires_at = clock_timestamp() - interval '1 second'
WHERE id = '00000000-0000-4000-8000-000000000025';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

SELECT is(
  (SELECT count(*) FROM public.claim_email_queue(10, 300, '10000000-0000-4000-8000-000000000003'::uuid)),
  1::bigint,
  'expired processing lease is reclaimable'
);
SELECT is(
  (SELECT lease_token FROM public.email_queue WHERE id = '00000000-0000-4000-8000-000000000025'),
  '10000000-0000-4000-8000-000000000003'::uuid,
  'reclaim replaces the stale lease token'
);
SELECT ok(
  (SELECT lease_token <> '10000000-0000-4000-8000-000000000001'::uuid
   FROM public.email_queue
   WHERE id = '00000000-0000-4000-8000-000000000025'),
  'reclaim invalidates the stale worker token'
);
SELECT is(
  (SELECT count(*) FROM public.claim_email_queue(10, 300, '10000000-0000-4000-8000-000000000004'::uuid)),
  0::bigint,
  'a reclaimed row cannot be claimed twice'
);
SELECT ok(
  (SELECT lease_expires_at > clock_timestamp()
   FROM public.email_queue
   WHERE id = '00000000-0000-4000-8000-000000000025'),
  'reclaim installs a live lease deadline'
);
SELECT is(
  (SELECT status FROM public.email_queue WHERE id = '00000000-0000-4000-8000-000000000025'),
  'processing',
  'reclaimed row remains isolated in processing state'
);

ROLLBACK;
