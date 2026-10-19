BEGIN;
SELECT plan(17);

SELECT has_table('public', 'email_system_settings', 'system settings exist');
SELECT has_table('public', 'email_delivery_controls', 'delivery controls exist');
SELECT has_table('public', 'email_delivery_events', 'delivery events exist');
SELECT has_table('public', 'email_action_tokens', 'action tokens exist');
SELECT has_table('public', 'email_test_recipients', 'test recipients exist');
SELECT has_table('public', 'email_admin_audit', 'email audit exists');

SELECT is(
  (SELECT count(*) FROM public.email_system_settings WHERE id = 'global'),
  1::bigint,
  'global settings singleton exists'
);
SELECT is(
  (SELECT platform_marketing_enabled FROM public.email_system_settings WHERE id = 'global'),
  false,
  'platform marketing is disabled by default'
);
SELECT is(
  (SELECT tenant_mail_enabled FROM public.email_system_settings WHERE id = 'global'),
  false,
  'tenant mail is disabled by default'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.email_delivery_events', 'insert'),
  'anon cannot insert delivery events'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.email_action_tokens', 'select'),
  'authenticated cannot read action tokens'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.email_admin_audit', 'delete'),
  'authenticated cannot delete email audit'
);
SELECT ok(
  has_table_privilege('service_role', 'public.email_delivery_events', 'insert'),
  'service role records delivery events'
);
SELECT ok(
  has_table_privilege('service_role', 'public.email_admin_audit', 'insert'),
  'service role records email audit'
);

INSERT INTO public.email_admin_audit (scope, action, resource_type, resource_id, outcome)
VALUES ('system', 'test', 'email', 'test-id', 'succeeded');

SELECT throws_ok(
  $$UPDATE public.email_admin_audit SET action = 'tampered' WHERE resource_id = 'test-id'$$,
  '42501',
  NULL,
  'email audit is append-only on update'
);
SELECT throws_ok(
  $$DELETE FROM public.email_admin_audit WHERE resource_id = 'test-id'$$,
  '42501',
  NULL,
  'email audit is append-only on delete'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'email_system_settings',
        'email_delivery_controls',
        'email_delivery_events',
        'email_action_tokens',
        'email_test_recipients',
        'email_admin_audit'
      )
      AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)
  ),
  'all email safety tables force RLS'
);

ROLLBACK;
