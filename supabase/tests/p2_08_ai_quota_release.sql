BEGIN;
SELECT plan(8);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000000081', 'AI Tenant', 'ai-tenant', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000000082', 'Suspended AI Tenant', 'suspended-ai-tenant', 'institution', encode(gen_random_bytes(32), 'hex'), 'suspended')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000000', 'ai-resident@example.com'),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000000', 'suspended-ai-resident@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.ai_quota_reservations
WHERE tenant_id IN (
  '00000000-0000-0000-0000-000000000081',
  '00000000-0000-0000-0000-000000000082'
);
DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000000081',
  '00000000-0000-0000-0000-000000000082'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000081', 'resident', 'AI Resident', 'active'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000082', 'resident', 'Suspended AI Resident', 'active');

INSERT INTO public.resident_ai_toggle (tenant_id, resident_id, enabled, quota_limit, quota_used)
VALUES
  ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000103', true, 20, 5),
  ('00000000-0000-0000-0000-000000000082', '00000000-0000-0000-0000-000000000104', true, 20, 5)
ON CONFLICT (tenant_id, resident_id)
DO UPDATE SET enabled = true, quota_limit = EXCLUDED.quota_limit, quota_used = EXCLUDED.quota_used;

CREATE TEMP TABLE quota_release_id (
  id UUID NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON TABLE quota_release_id TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000081","aal":"aal1"}';

INSERT INTO quota_release_id (id)
SELECT (public.consume_ai_quota('00000000-0000-0000-0000-000000000103', 1) ->> 'reservation_id')::UUID;

SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000000081' AND resident_id = '00000000-0000-0000-0000-000000000103'),
  6,
  'consume increments quota atomically'
);
SELECT ok(
  (SELECT count(*) FROM quota_release_id) = 1,
  'consume returns a reservation id'
);
SELECT throws_ok(
  $$SELECT public.release_ai_quota((SELECT id FROM quota_release_id))$$,
  '42501',
  NULL,
  'authenticated callers cannot release quota'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

SELECT is(
  public.release_ai_quota((SELECT id FROM quota_release_id)) ->> 'code',
  'ok',
  'service_role releases the exact reservation'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000000081' AND resident_id = '00000000-0000-0000-0000-000000000103'),
  5,
  'service_role release updates the exact reservation balance'
);
SELECT is(
  public.release_ai_quota((SELECT id FROM quota_release_id)) ->> 'code',
  'already_released',
  'duplicate release is idempotent'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000000081' AND resident_id = '00000000-0000-0000-0000-000000000103'),
  5,
  'duplicate release does not decrement the balance again'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000082","aal":"aal1"}';
SELECT is(
  public.consume_ai_quota('00000000-0000-0000-0000-000000000104', 1) ->> 'code',
  'tenant_suspended',
  'suspended tenant consumption is rejected'
);

ROLLBACK;
