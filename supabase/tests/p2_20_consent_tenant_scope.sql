-- p2_20 — consent writes are tenant-scoped; the RPC rejects cross-tenant calls.
BEGIN;
SELECT plan(3);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES
  ('00000000-0000-0000-0000-0000000001d1', 'Consent A', 'consent-a', 'individual', 'salt-c-a'),
  ('00000000-0000-0000-0000-0000000001d2', 'Consent B', 'consent-b', 'individual', 'salt-c-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-000000000000', 'consent-a@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-0000000001e1';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-0000000001f1', '00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001e1', 'resident', 'Consent A');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000001e1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000001d1","user_role":"resident"}}';

SELECT lives_ok(
  $$SELECT public.set_user_consent('00000000-0000-0000-0000-0000000001d1', 'analytics', true)$$,
  'member can set consent for their own tenant'
);

SELECT throws_ok(
  $$SELECT public.set_user_consent('00000000-0000-0000-0000-0000000001d2', 'analytics', true)$$,
  NULL,
  'RPC rejects a consent write for another tenant'
);

SELECT throws_ok(
  $$INSERT INTO public.consent_records (tenant_id, user_id, consent_type)
    VALUES ('00000000-0000-0000-0000-0000000001d2', '00000000-0000-0000-0000-0000000001e1', 'analytics')$$,
  NULL,
  'direct insert cannot spoof another tenant_id'
);

ROLLBACK;
