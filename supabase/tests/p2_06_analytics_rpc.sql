BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000061', 'Analytics Tenant', 'analytics-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000000', 'analytics@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000061';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000061', 'director', 'Analytics Director');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000061","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000061","user_role":"director"}}';

SELECT throws_ok(
  $$SELECT * FROM public.get_analytics_data('00000000-0000-0000-0000-000000000062')$$,
  '42501', NULL,
  'get_analytics_data rejects cross-tenant'
);
SELECT lives_ok(
  $$SELECT * FROM public.get_analytics_data('00000000-0000-0000-0000-000000000061')$$,
  'get_analytics_data works for own tenant'
);
ROLLBACK;
