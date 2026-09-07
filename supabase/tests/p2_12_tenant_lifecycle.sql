-- p2_12: tenant lifecycle state (T18).
BEGIN;
SELECT plan(3);

-- 1. New tenants default to active.
INSERT INTO tenants (id, name, slug, tenant_type)
VALUES ('00000000-0000-0000-0000-000000000034', 'Default State', 'default-state-tenant', 'institution')
ON CONFLICT (id) DO NOTHING;
SELECT is(
  (SELECT status FROM tenants WHERE id = '00000000-0000-0000-0000-000000000034'),
  'active',
  'new tenants default to active'
);

-- 2. Status column accepts only the lifecycle states.
SELECT throws_ok(
  $$INSERT INTO tenants (id, name, slug, tenant_type, status) VALUES ('00000000-0000-0000-0000-000000000032', 'Bad State', 'bad-state-tenant', 'institution', 'deleted')$$,
  '23514',
  'tenant status is allowlisted'
);

-- 3. Suspended state persists round-trip.
INSERT INTO tenants (id, name, slug, tenant_type, status, status_reason)
VALUES ('00000000-0000-0000-0000-000000000033', 'Susp Tenant', 'susp-tenant', 'institution', 'suspended', 'nonpayment')
ON CONFLICT (id) DO UPDATE SET status = 'suspended', status_reason = 'nonpayment';
SELECT is(
  (SELECT status FROM tenants WHERE id = '00000000-0000-0000-0000-000000000033'),
  'suspended',
  'suspended state round-trips'
);

ROLLBACK;
