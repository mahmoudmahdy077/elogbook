-- The AAL2 wrappers still gate every privileged RPC, and the two legacy
-- approval RPCs are no longer client-reachable at all: decide_case_command is
-- the only path out of `pending`, because it resolves one locked approval
-- request in the same transaction as the status change and writes the
-- idempotency ledger, the audit row and the outbox row with it. The AAL1
-- assertions below therefore still raise 42501, but from the grant rather than
-- from the AAL2 check, and the AAL2 assertions say the door is closed.
BEGIN;
SELECT plan(36);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000002601', 'AAL2 Tenant A', 'aal2-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000002602', 'AAL2 Tenant B', 'aal2-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000002611', '00000000-0000-0000-0000-000000000000', 'aal2-director@example.test'),
  ('00000000-0000-0000-0000-000000002612', '00000000-0000-0000-0000-000000000000', 'aal2-institution@example.test'),
  ('00000000-0000-0000-0000-000000002613', '00000000-0000-0000-0000-000000000000', 'aal2-admin@example.test'),
  ('00000000-0000-0000-0000-000000002614', '00000000-0000-0000-0000-000000000000', 'aal2-resident@example.test'),
  ('00000000-0000-0000-0000-000000002615', '00000000-0000-0000-0000-000000000000', 'aal2-platform@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000002611',
  '00000000-0000-0000-0000-000000002612',
  '00000000-0000-0000-0000-000000002613',
  '00000000-0000-0000-0000-000000002614',
  '00000000-0000-0000-0000-000000002615'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000002621', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002611', 'director', 'AAL2 Director', 'active'),
  ('00000000-0000-0000-0000-000000002622', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002612', 'institution_admin', 'AAL2 Institution Admin', 'active'),
  ('00000000-0000-0000-0000-000000002623', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002613', 'admin', 'AAL2 Tenant Admin', 'active'),
  ('00000000-0000-0000-0000-000000002624', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002614', 'resident', 'AAL2 Resident', 'active'),
  ('00000000-0000-0000-0000-000000002625', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002615', 'admin', 'AAL2 Platform Admin', 'active');

INSERT INTO public.platform_admins (user_id, status)
VALUES ('00000000-0000-0000-0000-000000002615', 'active')
ON CONFLICT (user_id) DO UPDATE SET status = 'active';

INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES ('00000000-0000-0000-0000-000000002631', '00000000-0000-0000-0000-000000002601', 'surgery', 'AAL2 Template', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, is_deidentified, field_values)
VALUES
  ('00000000-0000-0000-0000-000000002641', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624', '00000000-0000-0000-0000-000000002631', 'approved', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000002642', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624', '00000000-0000-0000-0000-000000002631', 'pending', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000002643', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624', '00000000-0000-0000-0000-000000002631', 'pending', true, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT has_function(
  'public',
  'require_privileged_principal',
  ARRAY['text[]', 'uuid', 'boolean'],
  'shared privileged principal guard exists'
);

SELECT is(
  has_function_privilege('anon', 'public.approve_case(uuid,uuid,text)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute approve_case'
);
SELECT is(
  has_function_privilege('anon', 'public.reject_case(uuid,uuid,text)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute reject_case'
);
SELECT is(
  has_function_privilege('anon', 'public.get_dashboard_data(uuid,uuid,text)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute dashboard RPC'
);
SELECT is(
  has_function_privilege('anon', 'public.get_analytics_data(uuid)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute analytics RPC'
);
SELECT is(
  has_function_privilege('anon', 'public.get_report_counts(uuid,text,text)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute report RPC'
);
SELECT is(
  has_function_privilege('anon', 'public.get_duty_4wk_violations(uuid)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute duty RPC'
);
SELECT is(
  has_function_privilege('anon', 'public.soft_delete_case(uuid)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute soft delete RPC'
);
SELECT is(
  has_function_privilege('anon', 'public.set_data_retention(uuid,integer,boolean)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute retention RPC'
);
SELECT is(
  has_function_privilege('anon', 'public.grant_ai_quota(uuid,integer,boolean)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute quota grant RPC'
);

SELECT is(
  has_function_privilege('service_role', 'public.get_dashboard_data(uuid,uuid,text)', 'EXECUTE'),
  false,
  'service role cannot execute user dashboard RPC'
);
SELECT is(
  has_function_privilege('service_role', 'public.get_analytics_data(uuid)', 'EXECUTE'),
  false,
  'service role cannot execute user analytics RPC'
);
SELECT is(
  has_function_privilege('service_role', 'public.get_report_counts(uuid,text,text)', 'EXECUTE'),
  false,
  'service role cannot execute user report RPC'
);
SELECT is(
  has_function_privilege('service_role', 'public.get_duty_4wk_violations(uuid)', 'EXECUTE'),
  false,
  'service role cannot execute user duty RPC'
);
SELECT is(
  has_function_privilege('service_role', 'public.approve_case(uuid,uuid,text)', 'EXECUTE'),
  false,
  'service role cannot execute user approval RPC'
);
SELECT is(
  has_function_privilege('service_role', 'public.reject_case(uuid,uuid,text)', 'EXECUTE'),
  false,
  'service role cannot execute user rejection RPC'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002611","role":"authenticated","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002602","user_role":"admin"}}';

SELECT throws_ok(
  $$SELECT public.get_dashboard_data('00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624', 'admin')$$,
  '42501',
  NULL,
  'AAL1 director cannot call the tenant dashboard RPC'
);
SELECT throws_ok(
  $$SELECT public.get_analytics_data('00000000-0000-0000-0000-000000002601')$$,
  '42501',
  NULL,
  'AAL1 director cannot call the tenant analytics RPC'
);
SELECT throws_ok(
  $$SELECT public.approve_case('00000000-0000-0000-0000-000000002642', '00000000-0000-0000-0000-000000002611', 'AAL1')$$,
  '42501',
  NULL,
  'AAL1 director cannot approve a tenant case'
);
SELECT throws_ok(
  $$SELECT public.reject_case('00000000-0000-0000-0000-000000002643', '00000000-0000-0000-0000-000000002611', 'AAL1')$$,
  '42501',
  NULL,
  'AAL1 director cannot reject a tenant case'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002612","role":"authenticated","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002601","user_role":"resident"}}';
SELECT throws_ok(
  $$SELECT public.get_report_counts('00000000-0000-0000-0000-000000002601', NULL, NULL)$$,
  '42501',
  NULL,
  'AAL1 institution administrator cannot call the tenant report RPC'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002613","role":"authenticated","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002601","user_role":"resident"}}';
SELECT throws_ok(
  $$SELECT public.grant_ai_quota('00000000-0000-0000-0000-000000002624', 20, FALSE)$$,
  '42501',
  NULL,
  'AAL1 tenant admin cannot grant quota'
);

SELECT throws_ok(
  $$SELECT public.soft_delete_case('00000000-0000-0000-0000-000000002641')$$,
  '42501',
  NULL,
  'AAL1 privileged users cannot soft-delete tenant cases'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002611","role":"authenticated","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002601","user_role":"resident"}}';
SELECT lives_ok(
  $$SELECT public.get_dashboard_data('00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624', 'resident')$$,
  'AAL2 director can call the tenant dashboard RPC'
);
SELECT lives_ok(
  $$SELECT public.get_analytics_data('00000000-0000-0000-0000-000000002601')$$,
  'AAL2 director can call the tenant analytics RPC'
);
SELECT throws_ok(
  $$SELECT public.approve_case('00000000-0000-0000-0000-000000002642', '00000000-0000-0000-0000-000000002611', 'AAL2')$$,
  '42501',
  NULL,
  'the retired approve_case RPC is not client-reachable at AAL2 either'
);
SELECT throws_ok(
  $$SELECT public.reject_case('00000000-0000-0000-0000-000000002643', '00000000-0000-0000-0000-000000002611', 'AAL2')$$,
  '42501',
  NULL,
  'the retired reject_case RPC is not client-reachable at AAL2 either'
);
SELECT is(
  has_function_privilege('authenticated', 'public.approve_case(uuid,uuid,text)', 'EXECUTE'),
  false,
  'authenticated holds no execute grant on the retired approve_case RPC'
);
SELECT is(
  has_function_privilege('authenticated', 'public.reject_case(uuid,uuid,text)', 'EXECUTE'),
  false,
  'authenticated holds no execute grant on the retired reject_case RPC'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002614","role":"authenticated","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002601","user_role":"admin"}}';
SELECT lives_ok(
  $$SELECT public.get_dashboard_data('00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624', 'resident')$$,
  'AAL1 resident self-service dashboard remains available'
);
SELECT lives_ok(
  $$SELECT public.get_template_usage_counts('00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624')$$,
  'AAL1 resident self-service template usage remains available'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002615","role":"authenticated","aal":"aal2"}';
SELECT is(
  public.require_privileged_principal(ARRAY['admin']::TEXT[], '00000000-0000-0000-0000-000000002602', TRUE),
  true,
  'an active platform registry admin has explicit cross-tenant authority'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002613","role":"authenticated","aal":"aal2"}';
SELECT is(
  public.require_privileged_principal(ARRAY['admin']::TEXT[], '00000000-0000-0000-0000-000000002602', TRUE),
  false,
  'a tenant-scoped admin label does not grant cross-tenant authority'
);

RESET ROLE;
UPDATE public.profiles SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-000000002621';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002611","role":"authenticated","aal":"aal2"}';
SELECT throws_ok(
  $$SELECT public.get_dashboard_data('00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624', 'resident')$$,
  '42501',
  NULL,
  'suspended profiles cannot call privileged RPCs'
);

RESET ROLE;
UPDATE public.profiles SET status = 'active' WHERE id = '00000000-0000-0000-0000-000000002621';
UPDATE public.tenants SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-000000002601';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002611","role":"authenticated","aal":"aal2"}';
SELECT throws_ok(
  $$SELECT public.get_dashboard_data('00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002624', 'resident')$$,
  '42501',
  NULL,
  'suspended tenants cannot call privileged RPCs'
);

RESET ROLE;
SELECT is_empty(
  $$
    SELECT function_record.proname
    FROM pg_proc AS function_record
    JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(function_record.proacl, acldefault('f', function_record.proowner))) AS acl
    LEFT JOIN pg_roles AS role_record ON role_record.oid = acl.grantee
    WHERE schema_record.nspname = 'public'
      AND function_record.proname IN (
        'approve_case', 'reject_case', 'get_dashboard_data', 'get_analytics_data',
        'get_report_counts', 'get_duty_4wk_violations', 'set_data_retention',
        'grant_ai_quota', 'store_ai_config', 'store_payment_gateway_secret',
        'store_tenant_webhook', 'relabel_case_mode', 'submit_case_operation', 'soft_delete_case'
      )
      AND acl.privilege_type = 'EXECUTE'
      AND (acl.grantee = 0 OR role_record.rolname IN ('anon', 'service_role'))
  $$,
  'privileged user RPCs have no PUBLIC, anon, or service_role execution grant'
);

ROLLBACK;
