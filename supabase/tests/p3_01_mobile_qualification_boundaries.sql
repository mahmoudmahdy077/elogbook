-- p3_01: mobile qualification boundaries — deterministic live-schema proofs (M8).
-- Deeper role/mode matrices (suspended, stale JWT, exports, AI, secret views)
-- run against fresh + upgraded disposable databases in CI; this file pins the
-- structural guarantees that must hold in every database.
BEGIN;
SELECT plan(5);

-- 1-2. Idempotency contract: partial unique index on client_operation_id.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_case_entries_client_op'),
  'ux_case_entries_client_op index exists'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ux_case_entries_client_op' AND indexdef ILIKE '%WHERE%IS NOT NULL%'),
  'idempotency index is partial (legacy NULL rows unaffected)'
);

-- 3. Publish RPC is service-role-only (no anon/authenticated execute).
SELECT is(
  has_function_privilege('authenticated', 'public.publish_site_page(uuid, uuid, uuid, boolean, uuid, uuid)', 'execute'),
  false,
  'authenticated role cannot execute publish_site_page directly'
);

-- 4-5. Audit surfaces are deny-by-default for client roles.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000093","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000021","user_role":"resident"}}';
SELECT is_empty(
  $$SELECT FROM public.audit_outbox$$,
  'authenticated users cannot enumerate the audit outbox'
);
SELECT is_empty(
  $$SELECT FROM public.audit_logs$$,
  'authenticated users cannot enumerate audit logs'
);
RESET ROLE;

ROLLBACK;
