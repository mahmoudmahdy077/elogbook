-- p2_18 — mobile_app_config is tenant-scoped, read-only for members and
-- writable only by tenant admins (web control plane).
BEGIN;
SELECT plan(6);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES
  ('00000000-0000-0000-0000-000000000181', 'Mobile Tenant', 'mobile-tenant', 'institution', encode(gen_random_bytes(32), 'hex')),
  ('00000000-0000-0000-0000-000000000182', 'Other Mobile Tenant', 'other-mobile-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000181', '00000000-0000-0000-0000-000000000000', 'mobile-resident@example.com'),
  ('00000000-0000-0000-0000-000000000182', '00000000-0000-0000-0000-000000000000', 'mobile-director@example.com'),
  ('00000000-0000-0000-0000-000000000183', '00000000-0000-0000-0000-000000000000', 'other-director@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN (
  '00000000-0000-0000-0000-000000000181',
  '00000000-0000-0000-0000-000000000182',
  '00000000-0000-0000-0000-000000000183'
);
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000281', '00000000-0000-0000-0000-000000000181', '00000000-0000-0000-0000-000000000181', 'resident', 'Mobile Resident'),
  ('00000000-0000-0000-0000-000000000282', '00000000-0000-0000-0000-000000000181', '00000000-0000-0000-0000-000000000182', 'director', 'Mobile Director'),
  ('00000000-0000-0000-0000-000000000283', '00000000-0000-0000-0000-000000000182', '00000000-0000-0000-0000-000000000183', 'director', 'Other Director');

INSERT INTO public.mobile_app_config (tenant_id, enabled_features, maintenance_mode)
VALUES ('00000000-0000-0000-0000-000000000181', '{"approvals": false}'::jsonb, false)
ON CONFLICT (tenant_id) DO NOTHING;

-- ── resident: read own tenant, no writes ────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000181","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000181","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.mobile_app_config),
  1::bigint,
  'resident reads the tenant mobile config'
);

SELECT throws_ok(
  $$INSERT INTO public.mobile_app_config (tenant_id, maintenance_mode)
    VALUES ('00000000-0000-0000-0000-000000000181', true)$$,
  NULL,
  'resident cannot create the mobile config'
);

SELECT is(
  (WITH changed AS (
     UPDATE public.mobile_app_config SET maintenance_mode = true RETURNING 1
   ) SELECT count(*) FROM changed),
  0::bigint,
  'resident cannot update the mobile config'
);

-- ── tenant director: write allowed ──────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000182","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000181","user_role":"director"}}';

SELECT lives_ok(
  $$UPDATE public.mobile_app_config SET maintenance_mode = true
    WHERE tenant_id = '00000000-0000-0000-0000-000000000181'$$,
  'tenant director updates the mobile config'
);

-- ── other-tenant director: denied ───────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000183","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000182","user_role":"director"}}';

SELECT is(
  (SELECT count(*) FROM public.mobile_app_config),
  0::bigint,
  'another tenant cannot read the config'
);

SELECT throws_ok(
  $$INSERT INTO public.mobile_app_config (tenant_id, maintenance_mode)
    VALUES ('00000000-0000-0000-0000-000000000181', true)$$,
  NULL,
  'another tenant cannot write the config'
);

ROLLBACK;
