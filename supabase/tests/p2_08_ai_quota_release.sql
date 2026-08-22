BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000081', 'AI Tenant', 'ai-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000000', 'ai-resident@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000081';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000081', 'resident', 'AI Resident');

INSERT INTO resident_ai_toggle (tenant_id, resident_id, enabled, quota_limit, quota_used)
VALUES ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000103', true, 20, 5)
ON CONFLICT (tenant_id, resident_id) DO UPDATE SET quota_used = 5;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000081","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000081","user_role":"resident"}}';

SELECT is(
  (SELECT (public.consume_ai_quota('00000000-0000-0000-0000-000000000103', 1)->>'quota_used')::int),
  6,
  'consume increments quota atomically'
);
SELECT is(
  (SELECT (public.release_ai_quota('00000000-0000-0000-0000-000000000103', 1)->>'quota_used')::int),
  5,
  'release decrements quota back'
);
ROLLBACK;
