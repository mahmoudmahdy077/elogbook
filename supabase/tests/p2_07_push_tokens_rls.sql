BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000071', 'Push Tenant', 'push-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000000', 'push-a@example.com'),
  ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000000', 'push-b@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000071', 'resident', 'Push A'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072', 'resident', 'Push B');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000071","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000071","user_role":"resident"}}';

SELECT lives_ok(
  $$INSERT INTO public.push_tokens (tenant_id, user_id, token, platform)
    VALUES ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000071', 'ExponentPushToken[test-a]', 'android')$$,
  'user can register their own push token'
);
SELECT throws_ok(
  $$INSERT INTO public.push_tokens (tenant_id, user_id, token, platform)
    VALUES ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072', 'ExponentPushToken[test-b]', 'android')$$,
  NULL,
  'user cannot register a token for another user'
);
ROLLBACK;
