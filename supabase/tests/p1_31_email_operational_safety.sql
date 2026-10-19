BEGIN;
SELECT plan(23);

SELECT has_table('public', 'email_send_audit', 'send audit table exists');
SELECT has_table('public', 'email_unsubscribe_preferences', 'template unsubscribe table exists');
SELECT has_column('public', 'email_send_audit', 'attempt_id', 'send audit carries an attempt id');
SELECT has_column('public', 'email_send_audit', 'error_code', 'send audit carries a sanitized error code');
SELECT has_column('public', 'email_unsubscribe_preferences', 'recipient_hmac', 'unsubscribe state stores only a recipient HMAC');
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.email_send_audit'::regclass),
  'send audit forces RLS'
);
SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.email_unsubscribe_preferences'::regclass),
  'unsubscribe state forces RLS'
);
SELECT ok(
  has_table_privilege('service_role', 'public.email_send_audit', 'insert')
  AND has_table_privilege('service_role', 'public.email_send_audit', 'select'),
  'service role can append and read send audit'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.email_send_audit', 'select')
  AND NOT has_table_privilege('authenticated', 'public.email_unsubscribe_preferences', 'select'),
  'ordinary clients cannot read email operational state'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.email_templates
    WHERE subject ~* '\\{\\{(message|body_html|body_text|summary|reviewer_name|resident_name)\\}\\}'
       OR html ~* '\\{\\{(message|body_html|body_text|summary|reviewer_name|resident_name)\\}\\}'
       OR text ~* '\\{\\{(message|body_html|body_text|summary|reviewer_name|resident_name)\\}\\}'
  ),
  'active templates contain no sensitive body variables'
);
SELECT throws_ok(
  $$INSERT INTO public.email_queue (template_key, to_email, payload)
    VALUES ('digest.weekly', 'payload-guard@example.test', '{"message":"sensitive"}'::jsonb)$$,
  '23514',
  NULL,
  'sensitive email queue payloads are rejected'
);
SELECT throws_ok(
  $$INSERT INTO public.email_queue (template_key, to_email, payload)
    VALUES ('digest.weekly', 'nested-payload-guard@example.test', '{"case_url":{"message":"sensitive"}}'::jsonb)$$,
  '23514',
  NULL,
  'nested and non-string email queue payloads are rejected'
);

INSERT INTO public.email_send_audit (
  attempt_id, template_key, provider, phase
) VALUES (
  '10000000-0000-4000-8000-000000000031', 'digest.weekly', 'resend', 'started'
);
SELECT throws_ok(
  $$UPDATE public.email_send_audit SET phase = 'accepted'
    WHERE attempt_id = '10000000-0000-4000-8000-000000000031'$$,
  '42501',
  NULL,
  'send audit is append-only'
);
SELECT has_function(
  'public',
  'record_email_delivery_event',
  ARRAY['text', 'text', 'text', 'text', 'text', 'jsonb', 'timestamptz'],
  'transactional webhook RPC exists'
);
SELECT ok(
  pg_get_function_result('public.claim_email_queue(integer, integer, uuid)'::regprocedure) LIKE '%tenant_id uuid%',
  'queue claim RPC returns tenant scope'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.email_logs'::regclass
      AND conname = 'email_logs_status_check'
      AND pg_get_constraintdef(oid) LIKE '%delivered%'
  ),
  'email log status constraint permits delivered'
);

INSERT INTO public.email_queue (
  id, template_key, to_email, tenant_id, payload
) VALUES (
  '10000000-0000-4000-8000-000000000032',
  'digest.weekly',
  'tenant-scope-32@example.test',
  '00000000-0000-0000-0000-000000003201',
  '{"dashboard_url":"https://app.example.test"}'::jsonb
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

SELECT is(
  (
    SELECT tenant_id
    FROM public.claim_email_queue(
      100,
      300,
      '10000000-0000-4000-8000-000000000033'::uuid
    )
    WHERE id = '10000000-0000-4000-8000-000000000032'
  ),
  '00000000-0000-0000-0000-000000003201'::uuid,
  'queue claim preserves tenant scope'
);
INSERT INTO public.email_logs (
  id, queue_id, to_email, template_key, provider, provider_id, status
) VALUES (
  '10000000-0000-4000-8000-000000000034',
  '10000000-0000-4000-8000-000000000032',
  'tenant-scope-32@example.test',
  'digest.weekly',
  'resend',
  'provider-message-32',
  'sent'
);
SELECT is(
  (
    SELECT replayed
    FROM public.record_email_delivery_event(
      'resend',
      'event-32-delivered',
      'delivered',
      'provider-message-32',
      repeat('e', 64),
      jsonb_build_array(jsonb_build_object('email', 'tenant-scope-32@example.test', 'recipient_hmac', repeat('f', 64))),
      clock_timestamp()
    )
  ),
  false,
  'delivered webhook event is accepted'
);
SELECT is(
  (SELECT status FROM public.email_logs WHERE id = '10000000-0000-4000-8000-000000000034'),
  'delivered',
  'delivered webhook event updates the matching provider log'
);

SELECT is(
  (
    SELECT replayed
    FROM public.record_email_delivery_event(
      'resend',
      'event-31',
      'hard_bounced',
      'provider-message-31',
      repeat('a', 64),
      jsonb_build_array(jsonb_build_object('email', 'bounce-31@example.test', 'recipient_hmac', repeat('b', 64))),
      clock_timestamp()
    )
  ),
  false,
  'first webhook event is processed'
);
SELECT is(
  (
    SELECT replayed
    FROM public.record_email_delivery_event(
      'resend',
      'event-31',
      'hard_bounced',
      'provider-message-31',
      repeat('a', 64),
      jsonb_build_array(jsonb_build_object('email', 'bounce-31@example.test', 'recipient_hmac', repeat('b', 64))),
      clock_timestamp()
    )
  ),
  true,
  'duplicate provider event is a replay'
);
SELECT is(
  (SELECT count(*) FROM public.email_delivery_events WHERE provider_event_id = 'event-31'),
  1::bigint,
  'replay does not duplicate the event record'
);
SELECT throws_ok(
  $$SELECT public.record_email_delivery_event(
    'resend',
    'event-32',
    'unsubscribed',
    'unknown-provider-message',
    repeat('c', 64),
    jsonb_build_array(jsonb_build_object('email', 'unsubscribe-32@example.test', 'recipient_hmac', repeat('d', 64))),
    clock_timestamp()
  )$$,
  'P0001',
  NULL,
  'unscoped unsubscribe event is rejected atomically'
);

RESET ROLE;
ROLLBACK;
