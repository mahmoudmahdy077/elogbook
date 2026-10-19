BEGIN;
SELECT plan(21);

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('sync_pull_changes', 'sync_push_batch')
  ),
  0,
  'legacy sync RPC names are absent from the final schema'
);

SELECT ok(
  to_regprocedure('public.sync_pull_changes(text,uuid,timestamptz,int)') IS NULL,
  'legacy sync_pull_changes signature is absent'
);

SELECT ok(
  to_regprocedure('public.sync_push_batch(text,jsonb)') IS NULL,
  'legacy sync_push_batch signature is absent'
);

SELECT is_empty(
  $$
  SELECT p.proname
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  LEFT JOIN pg_roles AS r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'log_backup_run',
      'check_case_quota',
      'get_analytics_data',
      'get_report_counts',
      'get_dashboard_data',
      'get_duty_4wk_violations',
      'submit_case_operation',
      'store_ai_config',
      'store_payment_gateway_secret',
      'relabel_case_mode',
      'tenant_identifiable_allowed'
    )
    AND acl.privilege_type = 'EXECUTE'
    AND (acl.grantee = 0 OR r.rolname = 'anon')
  $$,
  'sensitive RPCs have no PUBLIC or anon execute grant'
);

SELECT is_empty(
  $$
  SELECT p.proname
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  LEFT JOIN pg_roles AS r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND p.proname = 'log_backup_run'
    AND acl.privilege_type = 'EXECUTE'
    AND (acl.grantee = 0 OR r.rolname = 'anon')
  $$,
  'anon cannot execute the backup logging RPC'
);

SELECT is_empty(
  $$
  SELECT p.proname
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  LEFT JOIN pg_roles AS r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND p.proname = 'log_backup_run'
    AND acl.privilege_type = 'EXECUTE'
    AND (acl.grantee = 0 OR r.rolname = 'authenticated')
  $$,
  'authenticated cannot execute the backup logging RPC'
);

SELECT is_empty(
  $$
  SELECT function_record.oid::regprocedure::text
  FROM pg_proc AS function_record
  JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
  WHERE schema_record.nspname = 'public'
    AND function_record.proname = 'get_case_stats'
    AND function_record.oid IS DISTINCT FROM to_regprocedure('public.get_case_stats(uuid,date,date)')
  $$,
  'legacy get_case_stats overloads are absent'
);

SELECT is_empty(
  $$
  SELECT function_record.oid::regprocedure::text
  FROM pg_proc AS function_record
  JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(function_record.proacl, acldefault('f', function_record.proowner))
  ) AS acl
  LEFT JOIN pg_roles AS role_record ON role_record.oid = acl.grantee
  WHERE schema_record.nspname = 'public'
    AND function_record.oid = to_regprocedure('public.set_data_retention(uuid,integer,boolean)')
    AND acl.privilege_type = 'EXECUTE'
    AND (acl.grantee = 0 OR role_record.rolname = 'anon')
  $$,
  'set_data_retention has no PUBLIC or anon execute privilege'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    to_regprocedure('public.set_data_retention(uuid,integer,boolean)'),
    'EXECUTE'
  ),
  true,
  'authenticated can execute set_data_retention'
);

SELECT is_empty(
  $$
  SELECT required.table_name
  FROM (
    VALUES
      ('ai_config'),
      ('payment_gateway_config'),
      ('tenant_webhooks'),
      ('tenant_webhook_deliveries'),
      ('tenant_sso_configs')
  ) AS required(table_name)
  WHERE has_table_privilege(
          'authenticated',
          format('public.%s', required.table_name),
          'SELECT'
        )
     OR has_table_privilege(
          'authenticated',
          format('public.%s', required.table_name),
          'UPDATE'
        )
     OR has_table_privilege(
          'authenticated',
          format('public.%s', required.table_name),
          'DELETE'
        )
  $$,
  'authenticated has no direct secret-table mutation or read privilege'
);

SELECT is_empty(
  $$
  SELECT column_record.table_name
  FROM information_schema.columns AS column_record
  WHERE column_record.table_schema = 'public'
    AND column_record.table_name IN (
      'secret_ai_config',
      'secret_payment_gateway_config',
      'secret_tenant_webhooks'
    )
    AND column_record.column_name IN (
      'api_key',
      'secret',
      'secret_key',
      'webhook_secret'
    )
  $$,
  'client secret views expose no secret columns'
);

SELECT is(
  has_function_privilege(
    'anon',
    to_regprocedure('public.consume_ai_quota(uuid,integer)'),
    'EXECUTE'
  ),
  false,
  'anon cannot execute consume_ai_quota'
);

SELECT is(
  has_function_privilege(
    'anon',
    to_regprocedure('public.grant_ai_quota(uuid,integer,boolean)'),
    'EXECUTE'
  ),
  false,
  'anon cannot execute grant_ai_quota'
);

SELECT is(
  has_function_privilege(
    'anon',
    to_regprocedure('public.release_ai_quota(uuid)'),
    'EXECUTE'
  ),
  false,
  'anon cannot execute release_ai_quota'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    to_regprocedure('public.release_ai_quota(uuid)'),
    'EXECUTE'
  ),
  false,
  'authenticated cannot execute release_ai_quota'
);

SELECT is(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.release_ai_quota(uuid)'),
    'EXECUTE'
  ),
  true,
  'service_role can execute release_ai_quota'
);

SELECT is(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.get_case_stats(uuid,date,date)'),
    'EXECUTE'
  ),
  false,
  'service_role cannot execute the authenticated case statistics RPC'
);

SELECT is_empty(
  $$
  WITH allowed(proname, identity_arguments) AS (
    VALUES
      ('claim_email_queue', 'integer, integer, uuid'),
      ('decrypt_with_version', 'bytea, integer'),
      ('enforce_data_retention', ''),
      ('get_tenant_webhook_secret', 'uuid'),
      ('log_backup_run', 'text, bigint, text'),
      ('mark_stripe_event_failed', 'text, text'),
      ('publish_site_page', 'uuid, uuid, uuid, boolean, uuid, uuid'),
      ('refresh_benchmark_mv', ''),
      ('release_ai_quota', 'uuid'),
      ('rotate_encryption_key', 'integer, integer'),
      ('rotate_mrn_salt', 'uuid'),
      ('rotate_tenant_webhook_secrets', 'jsonb')
  )
  SELECT function_record.proname
  FROM pg_proc AS function_record
  JOIN pg_namespace AS schema_record
    ON schema_record.oid = function_record.pronamespace
  WHERE schema_record.nspname = 'public'
    AND function_record.prosecdef
    AND has_function_privilege('service_role', function_record.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM allowed
      WHERE allowed.proname = function_record.proname
        AND allowed.identity_arguments = pg_get_function_identity_arguments(function_record.oid)
    )
  $$,
  'service_role definer grants are limited to reviewed callers'
);

SELECT is(
  has_function_privilege(
    'anon',
    to_regprocedure('public.set_data_retention(uuid,integer,boolean)'),
    'EXECUTE'
  ),
  false,
  'anon cannot execute set_data_retention'
);

SELECT is(
  has_table_privilege('service_role', 'public.tenant_webhooks', 'SELECT'),
  true,
  'service_role retains direct webhook operations access'
);

SELECT is(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.get_tenant_webhook_secret(uuid)'),
    'EXECUTE'
  ),
  true,
  'service_role retains the webhook secret resolution RPC'
);

ROLLBACK;
