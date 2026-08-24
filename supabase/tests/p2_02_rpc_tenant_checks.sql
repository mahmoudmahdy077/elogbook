BEGIN;
SELECT plan(4);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000021', 'RPC Tenant', 'rpc-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000000', 'rpc-resident@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000021';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000021', 'resident', 'RPC Resident');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000021","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000021","user_role":"resident"}}';

SELECT throws_ok(
  $$SELECT * FROM public.get_dashboard_data('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000093', 'resident')$$,
  '42501', NULL,
  'get_dashboard_data rejects cross-tenant p_tenant_id'
);
SELECT throws_ok(
  $$SELECT * FROM public.check_case_quota('00000000-0000-0000-0000-000000000022')$$,
  '42501', NULL,
  'check_case_quota rejects cross-tenant p_tenant_id'
);
SELECT throws_ok(
  $$SELECT * FROM public.get_template_usage_counts('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000093')$$,
  '42501', NULL,
  'get_template_usage_counts rejects cross-tenant p_tenant_id'
);
SELECT lives_ok(
  $$SELECT * FROM public.get_dashboard_data('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000093', 'resident')$$,
  'get_dashboard_data works for own tenant'
);
ROLLBACK;
