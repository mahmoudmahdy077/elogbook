BEGIN;
SELECT plan(19);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000002410', 'Quota Reservation Tenant A', 'quota-reservation-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000002420', 'Quota Reservation Tenant B', 'quota-reservation-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000002411', '00000000-0000-0000-0000-000000000000', 'quota-a@example.com'),
  ('00000000-0000-0000-0000-000000002421', '00000000-0000-0000-0000-000000000000', 'quota-b@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.ai_quota_reservations
WHERE tenant_id IN (
  '00000000-0000-0000-0000-000000002410',
  '00000000-0000-0000-0000-000000002420'
);
DELETE FROM public.profiles
WHERE id IN (
  '00000000-0000-0000-0000-000000002412',
  '00000000-0000-0000-0000-000000002422'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000002412', '00000000-0000-0000-0000-000000002410', '00000000-0000-0000-0000-000000002411', 'resident', 'Quota Resident A', 'active'),
  ('00000000-0000-0000-0000-000000002422', '00000000-0000-0000-0000-000000002420', '00000000-0000-0000-0000-000000002421', 'resident', 'Quota Resident B', 'active');

INSERT INTO public.resident_ai_toggle (tenant_id, resident_id, enabled, quota_limit, quota_used)
VALUES
  ('00000000-0000-0000-0000-000000002410', '00000000-0000-0000-0000-000000002412', true, 20, 0),
  ('00000000-0000-0000-0000-000000002420', '00000000-0000-0000-0000-000000002422', true, 20, 0)
ON CONFLICT (tenant_id, resident_id)
DO UPDATE SET enabled = true, quota_limit = EXCLUDED.quota_limit, quota_used = EXCLUDED.quota_used;

CREATE TEMP TABLE quota_reservation_ids (
  name TEXT PRIMARY KEY,
  id UUID NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT ON TABLE quota_reservation_ids TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002411","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002420","user_role":"admin"}}';

INSERT INTO quota_reservation_ids (name, id)
SELECT 'first', (public.consume_ai_quota('00000000-0000-0000-0000-000000002412', 1) ->> 'reservation_id')::UUID;

-- The consume above ran as the resident; this assertion reads the toggle
-- directly, and authenticated holds no grant on it, so it runs as the owner.
RESET ROLE;
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000002410' AND resident_id = '00000000-0000-0000-0000-000000002412'),
  1,
  'consume records a quota reservation increment'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002411","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002410","user_role":"resident"}}';
SELECT ok(
  (SELECT count(*) FROM quota_reservation_ids WHERE name = 'first') = 1,
  'consume returns a single reservation id'
);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SELECT is(
  (SELECT actor_profile_id FROM public.ai_quota_reservations WHERE id = (SELECT id FROM quota_reservation_ids WHERE name = 'first')),
  '00000000-0000-0000-0000-000000002412'::UUID,
  'reservation records the authoritative actor profile'
);
SELECT is(
  (SELECT count(*) FROM public.ai_quota_reservations WHERE tenant_id = '00000000-0000-0000-0000-000000002410'),
  1::BIGINT,
  'reservation records the resident tenant'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002411","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002420","user_role":"admin"}}';
SELECT is(
  public.consume_ai_quota('00000000-0000-0000-0000-000000002422', 1) ->> 'code',
  'forbidden',
  'a resident cannot consume quota for a cross-tenant target'
);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SELECT is(
  (SELECT count(*) FROM public.ai_quota_reservations),
  1::BIGINT,
  'cross-tenant consumption creates no reservation'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002411","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002420","user_role":"admin"}}';
SELECT throws_ok(
  $$SELECT public.release_ai_quota((SELECT id FROM quota_reservation_ids WHERE name = 'first'))$$,
  '42501',
  NULL,
  'authenticated callers cannot release reservations'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role","sub":"00000000-0000-0000-0000-000000002411"}';

SELECT is(
  public.release_ai_quota((SELECT id FROM quota_reservation_ids WHERE name = 'first')) ->> 'code',
  'ok',
  'service role releases the exact reservation'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000002410' AND resident_id = '00000000-0000-0000-0000-000000002412'),
  0,
  'release decrements only the reserved unit'
);
SELECT is(
  public.release_ai_quota((SELECT id FROM quota_reservation_ids WHERE name = 'first')) ->> 'code',
  'already_released',
  'duplicate release is idempotent'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000002410' AND resident_id = '00000000-0000-0000-0000-000000002412'),
  0,
  'duplicate release does not decrement quota again'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002411","aal":"aal1"}';
INSERT INTO quota_reservation_ids (name, id)
SELECT 'second', (public.consume_ai_quota('00000000-0000-0000-0000-000000002412', 1) ->> 'reservation_id')::UUID;
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000002410' AND resident_id = '00000000-0000-0000-0000-000000002412'),
  1,
  'a later reservation is independent of the released reservation'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SELECT is(
  public.release_ai_quota((SELECT id FROM quota_reservation_ids WHERE name = 'second')) ->> 'code',
  'ok',
  'service role releases a later reservation'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000002410' AND resident_id = '00000000-0000-0000-0000-000000002412'),
  0,
  'reservation releases do not decrement unrelated later usage'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002421","aal":"aal1"}';
INSERT INTO quota_reservation_ids (name, id)
SELECT 'other_tenant', (public.consume_ai_quota('00000000-0000-0000-0000-000000002422', 1) ->> 'reservation_id')::UUID;
SELECT ok(
  (SELECT count(*) FROM quota_reservation_ids WHERE name = 'other_tenant') = 1,
  'other tenant creates its own reservation'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role","sub":"00000000-0000-0000-0000-000000002411"}';
SELECT is(
  public.release_ai_quota((SELECT id FROM quota_reservation_ids WHERE name = 'other_tenant')) ->> 'code',
  'forbidden',
  'tenant-bound service-role context cannot release another tenant reservation'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000002420' AND resident_id = '00000000-0000-0000-0000-000000002422'),
  1,
  'cross-tenant release does not mutate the target balance'
);
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SELECT is(
  public.release_ai_quota((SELECT id FROM quota_reservation_ids WHERE name = 'other_tenant')) ->> 'code',
  'ok',
  'global service role can release the reservation'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000002420' AND resident_id = '00000000-0000-0000-0000-000000002422'),
  0,
  'global service release updates the exact target balance'
);

ROLLBACK;
