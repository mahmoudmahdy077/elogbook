BEGIN;
SELECT plan(50);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000002401', 'Final Authorization Tenant A', 'final-authorization-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000002402', 'Final Authorization Tenant B', 'final-authorization-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000002411', '00000000-0000-0000-0000-000000000000', 'final-authorization-admin-a@example.test'),
  ('00000000-0000-0000-0000-000000002412', '00000000-0000-0000-0000-000000000000', 'final-authorization-admin-b@example.test'),
  ('00000000-0000-0000-0000-000000002413', '00000000-0000-0000-0000-000000000000', 'final-authorization-resident-a@example.test'),
  ('00000000-0000-0000-0000-000000002414', '00000000-0000-0000-0000-000000000000', 'final-authorization-replacement@example.test'),
  ('00000000-0000-0000-0000-000000002415', '00000000-0000-0000-0000-000000000000', 'final-authorization-suspended-admin@example.test'),
  ('00000000-0000-0000-0000-000000002416', '00000000-0000-0000-0000-000000000000', 'final-authorization-deleted-admin@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000002411',
  '00000000-0000-0000-0000-000000002412',
  '00000000-0000-0000-0000-000000002413',
  '00000000-0000-0000-0000-000000002414',
  '00000000-0000-0000-0000-000000002415',
  '00000000-0000-0000-0000-000000002416'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status, deleted_at)
VALUES
  ('00000000-0000-0000-0000-000000002421', '00000000-0000-0000-0000-000000002401', '00000000-0000-0000-0000-000000002411', 'institution_admin', 'Final Admin A', 'active', NULL),
  ('00000000-0000-0000-0000-000000002422', '00000000-0000-0000-0000-000000002402', '00000000-0000-0000-0000-000000002412', 'institution_admin', 'Final Admin B', 'active', NULL),
  ('00000000-0000-0000-0000-000000002423', '00000000-0000-0000-0000-000000002401', '00000000-0000-0000-0000-000000002413', 'resident', 'Final Resident A', 'active', NULL),
  ('00000000-0000-0000-0000-000000002424', '00000000-0000-0000-0000-000000002401', '00000000-0000-0000-0000-000000002415', 'institution_admin', 'Suspended Admin', 'suspended', NULL),
  ('00000000-0000-0000-0000-000000002425', '00000000-0000-0000-0000-000000002401', '00000000-0000-0000-0000-000000002416', 'institution_admin', 'Deleted Admin', 'active', NOW())
ON CONFLICT (id) DO NOTHING;

SELECT is(
  (
    SELECT count(*)
    FROM public.profiles
    WHERE tenant_id = '00000000-0000-0000-0000-000000002401'
      AND role IN ('admin', 'institution_admin')
      AND status = 'active'
      AND deleted_at IS NULL
  ),
  1::bigint,
  'the fixture has one active non-deleted tenant administrator'
);

SELECT is_empty(
  $$
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd IN ('UPDATE', 'DELETE', 'ALL')
      AND policyname NOT IN (
        'Active users can update their own mutable profile',
        'Tenant supervisors and administrators can update resident profiles',
        'Platform administrators can update profiles',
        'Tenant administrators can delete resident profiles',
        'Platform administrators can delete active profiles'
      )
  $$,
  'profiles has no extra unsafe update/delete policy'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'UPDATE'),
  3,
  'profiles has exactly the three reviewed UPDATE policies'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'DELETE'),
  2,
  'profiles has exactly the two reviewed DELETE policies'
);

SELECT is_empty(
  $$
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd = 'UPDATE'
      AND COALESCE(with_check, '') = ''
  $$,
  'every profiles UPDATE policy has a WITH CHECK expression'
);

SELECT is_empty(
  $$
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd = 'UPDATE'
      AND (
        COALESCE(with_check, '') NOT ILIKE '%get_tenant_id%'
        OR COALESCE(with_check, '') NOT ILIKE '%get_authoritative_principal_with_aal%'
      )
  $$,
  'every profiles UPDATE policy repeats tenant and authoritative actor context'
);

SELECT is_empty(
  $$
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd = 'DELETE'
      AND (
        COALESCE(qual, '') NOT ILIKE '%get_authoritative_principal_with_aal%'
        OR COALESCE(qual, '') NOT ILIKE '%aal2%'
      )
  $$,
  'every profiles DELETE policy requires authoritative AAL2'
);

SELECT is_empty(
  $$
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd = 'ALL'
  $$,
  'profiles has no broad FOR ALL policy'
);

SELECT ok(
  position('session_user' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) > 0
  AND position('current_setting(''role''' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) > 0
  AND position('auth.role() is distinct from ''service_role''' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) > 0
  AND position('profile mutations require authenticated administrator rpc' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) > 0
  AND position('has_aal2' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) = 0
  AND position('if v_is_service_role then return new' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) = 0,
  'the profile authorization trigger rejects service-role mutations without a fake AAL claim'
);

SELECT ok(
  position('for update' IN upper(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) > 0
  AND position('pg_advisory_xact_lock' IN upper(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) = 0,
  'last-administrator checks use a tenant row lock rather than an advisory lock'
);

SELECT ok(to_regprocedure('public.admin_update_profile(uuid,jsonb)') IS NOT NULL, 'profile update RPC exists');
SELECT ok(to_regprocedure('public.admin_assign_role(uuid,text)') IS NOT NULL, 'role assignment RPC exists');
SELECT ok(to_regprocedure('public.admin_set_profile_status(uuid,text)') IS NOT NULL, 'profile status RPC exists');
SELECT ok(to_regprocedure('public.admin_delete_profile(uuid)') IS NOT NULL, 'profile deletion RPC exists');
SELECT is(
  has_function_privilege('anon', 'public.admin_update_profile(uuid,jsonb)', 'EXECUTE'),
  false,
  'anonymous callers cannot update profiles through the admin RPC'
);
SELECT is(
  has_function_privilege('authenticated', 'public.admin_update_profile(uuid,jsonb)', 'EXECUTE'),
  true,
  'authenticated callers can update profiles through the admin RPC'
);
SELECT is(
  has_function_privilege('service_role', 'public.admin_update_profile(uuid,jsonb)', 'EXECUTE'),
  false,
  'service_role cannot use the user-facing profile RPC'
);
SELECT ok(
  position('get_authoritative_principal_with_aal' IN lower(pg_get_functiondef(to_regprocedure('public.admin_update_profile(uuid,jsonb)')))) > 0
  AND position('v_principal.aal is distinct from ''aal2''' IN lower(pg_get_functiondef(to_regprocedure('public.admin_update_profile(uuid,jsonb)')))) > 0
  AND position('for update' IN upper(pg_get_functiondef(to_regprocedure('public.admin_update_profile(uuid,jsonb)')))) > 0,
  'profile update RPC uses live AAL2 context and serializes tenant scope'
);

SELECT ok(
  position('to_regclass' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) > 0
  AND position('deleted_at' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) > 0
  AND position('old.deleted_at' IN lower(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))) = 0,
  'profile authorization guards tolerate schemas without deleted_at'
);

SELECT ok(
  (
    SELECT count(*)
    FROM regexp_matches(
      lower(pg_get_functiondef(to_regprocedure('public.get_case_stats(uuid,date,date)'))),
      'p_from_date[[:space:]]+is null or entry\.case_date[[:space:]]*>=[[:space:]]*p_from_date',
      'g'
    )
  ) >= 7
  AND (
    SELECT count(*)
    FROM regexp_matches(
      lower(pg_get_functiondef(to_regprocedure('public.get_case_stats(uuid,date,date)'))),
      'p_to_date[[:space:]]+is null or entry\.case_date[[:space:]]*<=[[:space:]]*p_to_date',
      'g'
    )
  ) >= 7,
  'every get_case_stats aggregate carries both date predicates'
);

SELECT is(
  has_function_privilege('anon', to_regprocedure('public.release_ai_quota(uuid)'), 'EXECUTE'),
  false,
  'anonymous callers cannot execute release_ai_quota'
);

SELECT is(
  has_function_privilege('authenticated', to_regprocedure('public.release_ai_quota(uuid)'), 'EXECUTE'),
  false,
  'authenticated callers cannot execute release_ai_quota'
);

SELECT is(
  has_function_privilege('service_role', to_regprocedure('public.release_ai_quota(uuid)'), 'EXECUTE'),
  true,
  'service_role can execute release_ai_quota'
);

SELECT ok(
  position('auth.role() is distinct from ''service_role''' IN lower(pg_get_functiondef(to_regprocedure('public.release_ai_quota(uuid)')))) > 0,
  'release_ai_quota rejects non-service-role request context in the function body'
);

SELECT is_empty(
  $$
    SELECT required.relation_name
    FROM (
      VALUES
        ('ai_config'),
        ('payment_gateway_config'),
        ('tenant_webhooks'),
        ('tenant_webhook_deliveries'),
        ('tenant_sso_configs'),
        ('secret_ai_config'),
        ('secret_payment_gateway_config'),
        ('secret_tenant_webhooks')
    ) AS required(relation_name)
    WHERE to_regclass(format('public.%I', required.relation_name)) IS NULL
  $$,
  'required secret base tables and metadata views exist'
);

SELECT is_empty(
  $$
    WITH required(table_name) AS (
      VALUES
        ('ai_config'),
        ('payment_gateway_config'),
        ('tenant_webhooks'),
        ('tenant_webhook_deliveries'),
        ('tenant_sso_configs')
    )
    SELECT required.table_name, client.role_name
    FROM required
    CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) AS client(role_name)
    WHERE EXISTS (
      SELECT 1
      FROM (VALUES
        ('SELECT'),
        ('INSERT'),
        ('UPDATE'),
        ('DELETE'),
        ('TRUNCATE'),
        ('REFERENCES'),
        ('TRIGGER')
      ) AS privilege(privilege_name)
      WHERE has_table_privilege(
        client.role_name::name,
        to_regclass(format('public.%I', required.table_name)),
        privilege.privilege_name
      )
    )
  $$,
  'PUBLIC, anon, and authenticated have no effective privileges on secret base tables'
);

SELECT is_empty(
  $$
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('secret_ai_config', 'secret_payment_gateway_config', 'secret_tenant_webhooks')
      AND column_name IN (
        'api_key',
        'secret',
        'secret_key',
        'webhook_secret',
        'api_key_enc',
        'secret_key_enc',
        'webhook_secret_enc',
        'secret_enc',
        'encrypted_api_key',
        'encrypted_secret_key',
        'encrypted_webhook_secret',
        'credential',
        'credentials',
        'password',
        'token',
        'token_hash'
      )
  $$,
  'client secret views expose metadata only'
);

SELECT is_empty(
  $$
    WITH required(view_name) AS (
      VALUES
        ('secret_ai_config'),
        ('secret_payment_gateway_config'),
        ('secret_tenant_webhooks')
    )
    SELECT required.view_name, client.role_name
    FROM required
    CROSS JOIN (VALUES ('public'), ('anon')) AS client(role_name)
    WHERE EXISTS (
      SELECT 1
      FROM (VALUES
        ('SELECT'),
        ('INSERT'),
        ('UPDATE'),
        ('DELETE'),
        ('TRUNCATE'),
        ('REFERENCES'),
        ('TRIGGER')
      ) AS privilege(privilege_name)
      WHERE has_table_privilege(
        client.role_name::name,
        to_regclass(format('public.%I', required.view_name)),
        privilege.privilege_name
      )
    )
  $$,
  'PUBLIC and anon have no effective privileges on client secret views'
);

SELECT is_empty(
  $$
    WITH required(view_name) AS (
      VALUES
        ('secret_ai_config'),
        ('secret_payment_gateway_config'),
        ('secret_tenant_webhooks')
    )
    SELECT required.view_name
    FROM required
    WHERE NOT has_table_privilege(
            'authenticated',
            to_regclass(format('public.%I', required.view_name)),
            'SELECT'
          )
       OR has_table_privilege(
            'authenticated',
            to_regclass(format('public.%I', required.view_name)),
            'INSERT'
          )
       OR has_table_privilege(
            'authenticated',
            to_regclass(format('public.%I', required.view_name)),
            'UPDATE'
          )
       OR has_table_privilege(
            'authenticated',
            to_regclass(format('public.%I', required.view_name)),
            'DELETE'
          )
       OR has_table_privilege(
            'authenticated',
            to_regclass(format('public.%I', required.view_name)),
            'TRUNCATE'
          )
       OR has_table_privilege(
            'authenticated',
            to_regclass(format('public.%I', required.view_name)),
            'REFERENCES'
          )
       OR has_table_privilege(
            'authenticated',
            to_regclass(format('public.%I', required.view_name)),
            'TRIGGER'
          )
  $$,
  'authenticated has SELECT-only access to client secret views'
);

SELECT is_empty(
  $$
    WITH required(view_name) AS (
      VALUES
        ('secret_ai_config'),
        ('secret_payment_gateway_config'),
        ('secret_tenant_webhooks')
    )
    SELECT required.view_name
    FROM required
    WHERE NOT has_table_privilege(
            'service_role',
            to_regclass(format('public.%I', required.view_name)),
            'SELECT'
          )
       OR has_table_privilege(
            'service_role',
            to_regclass(format('public.%I', required.view_name)),
            'INSERT'
          )
       OR has_table_privilege(
            'service_role',
            to_regclass(format('public.%I', required.view_name)),
            'UPDATE'
          )
       OR has_table_privilege(
            'service_role',
            to_regclass(format('public.%I', required.view_name)),
            'DELETE'
          )
       OR has_table_privilege(
            'service_role',
            to_regclass(format('public.%I', required.view_name)),
            'TRUNCATE'
          )
       OR has_table_privilege(
            'service_role',
            to_regclass(format('public.%I', required.view_name)),
            'REFERENCES'
          )
       OR has_table_privilege(
            'service_role',
            to_regclass(format('public.%I', required.view_name)),
            'TRIGGER'
          )
  $$,
  'service_role has SELECT-only access to client secret views'
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
    JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
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
  'service-role SECURITY DEFINER grants are limited to the reviewed allowlist'
);

SELECT is_empty(
  $$
    SELECT required.signature
    FROM (
      VALUES
        ('public.claim_email_queue(integer, integer, uuid)'),
        ('public.decrypt_with_version(bytea, integer)'),
        ('public.enforce_data_retention()'),
        ('public.get_tenant_webhook_secret(uuid)'),
        ('public.log_backup_run(text, bigint, text)'),
        ('public.mark_stripe_event_failed(text, text)'),
        ('public.publish_site_page(uuid, uuid, uuid, boolean, uuid, uuid)'),
        ('public.refresh_benchmark_mv()'),
        ('public.release_ai_quota(uuid)'),
        ('public.rotate_encryption_key(integer, integer)'),
        ('public.rotate_mrn_salt(uuid)'),
        ('public.rotate_tenant_webhook_secrets(jsonb)')
    ) AS required(signature)
    WHERE to_regprocedure(required.signature) IS NULL
       OR NOT has_function_privilege('service_role', to_regprocedure(required.signature), 'EXECUTE')
  $$,
  'every required service-role operation remains executable'
);

SELECT is(
  has_function_privilege('service_role', to_regprocedure('public.log_backup_run(text,bigint,text)'), 'EXECUTE'),
  true,
  'service_role retains the backup logging RPC'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002411","role":"authenticated","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002401","user_role":"institution_admin"}}';

SELECT is(
  (public.admin_assign_role('00000000-0000-0000-0000-000000002423', 'supervisor') ->> 'success')::BOOLEAN,
  true,
  'AAL2 tenant administrator can assign a resident role through the RPC'
);
SELECT is(
  (public.admin_set_profile_status('00000000-0000-0000-0000-000000002423', 'deactivated') ->> 'success')::BOOLEAN,
  true,
  'AAL2 tenant administrator can deactivate a resident through the RPC'
);
SELECT is(
  (public.admin_set_profile_status('00000000-0000-0000-0000-000000002423', 'active') ->> 'success')::BOOLEAN,
  true,
  'AAL2 tenant administrator can reactivate a resident through the RPC'
);
SELECT is(
  (public.admin_assign_role('00000000-0000-0000-0000-000000002423', 'resident') ->> 'success')::BOOLEAN,
  true,
  'AAL2 tenant administrator can restore a resident role through the RPC'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002411","role":"authenticated","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002401","user_role":"institution_admin"}}';
SELECT is(
  (public.admin_assign_role('00000000-0000-0000-0000-000000002423', 'supervisor') ->> 'success')::BOOLEAN,
  false,
  'AAL1 tenant administrator cannot assign a role through the RPC'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002412","role":"authenticated","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002402","user_role":"institution_admin"}}';
SELECT is(
  (public.admin_assign_role('00000000-0000-0000-0000-000000002423', 'supervisor') ->> 'success')::BOOLEAN,
  false,
  'a tenant administrator cannot mutate a profile in another tenant'
);
SELECT is(
  (public.admin_delete_profile('00000000-0000-0000-0000-000000002423') ->> 'success')::BOOLEAN,
  false,
  'a tenant administrator cannot delete a profile in another tenant'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002411","role":"authenticated","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002401","user_role":"institution_admin"}}';
SELECT is(
  (public.admin_assign_role('00000000-0000-0000-0000-000000002421', 'resident') ->> 'success')::BOOLEAN,
  false,
  'the RPC preserves the last active tenant administrator'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

SELECT throws_ok(
  $$UPDATE public.profiles SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-000000002423'$$,
  '42501',
  NULL,
  'application service_role cannot change profile status'
);

SELECT throws_ok(
  $$DELETE FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000002423'$$,
  '42501',
  NULL,
  'application service_role cannot delete a profile'
);

SET LOCAL request.jwt.claims TO '{"role":"service_role","aal":"aal1","amr":["mfa"]}';

SELECT throws_ok(
  $$UPDATE public.profiles SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-000000002423'$$,
  '42501',
  NULL,
  'an explicit AAL1 claim cannot upgrade service-role profile authority'
);

SET LOCAL request.jwt.claims TO '{"role":"service_role","aal":"aal2"}';

SELECT throws_ok(
  $$UPDATE public.profiles SET role = 'supervisor' WHERE id = '00000000-0000-0000-0000-000000002423'$$,
  '42501',
  NULL,
  'a fake service-role AAL2 claim cannot authorize profile mutations'
);

RESET ROLE;
SET LOCAL request.jwt.claims TO '{}';

SELECT lives_ok(
  $$UPDATE public.profiles SET role = 'resident' WHERE id = '00000000-0000-0000-0000-000000002423'$$,
  'trusted migration context can perform an authoritative profile mutation without a JWT'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role","aal":"aal2"}';

SELECT throws_ok(
  $$UPDATE public.profiles SET user_id = '00000000-0000-0000-0000-000000002414' WHERE id = '00000000-0000-0000-0000-000000002421'$$,
  '42501',
  NULL,
  'the last active administrator cannot be reidentified'
);

SELECT throws_ok(
  $$UPDATE public.profiles SET tenant_id = '00000000-0000-0000-0000-000000002402' WHERE id = '00000000-0000-0000-0000-000000002421'$$,
  '42501',
  NULL,
  'the last active administrator cannot be moved to another tenant'
);

SELECT throws_ok(
  $$UPDATE public.profiles SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-000000002421'$$,
  '42501',
  NULL,
  'the last active administrator cannot be suspended'
);

SELECT throws_ok(
  $$UPDATE public.profiles SET deleted_at = NOW() WHERE id = '00000000-0000-0000-0000-000000002421'$$,
  '42501',
  NULL,
  'the last active administrator cannot be soft-deleted'
);

RESET ROLE;
ROLLBACK;
