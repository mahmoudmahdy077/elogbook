-- p3_05: SECURITY DEFINER audit for the operation path (N9).
-- Pins search_path + least-privilege grants on every function the mobile
-- queue and publication flows depend on. A full-catalog sweep lives in
-- migration 00052_normalize_search_path; this file guards the N-cycle
-- additions and the retired bypass against regressions.
BEGIN;
SELECT plan(7);

-- 1-2. The operation RPCs pin an explicit search_path.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'submit_case_operation'
            AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')),
  'submit_case_operation pins search_path'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'relabel_case_mode'
            AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')),
  'relabel_case_mode pins search_path'
);

-- 3. The retired dynamic bypass is closed to client roles.
SELECT is(
  has_function_privilege('authenticated', 'public.sync_push_batch(text, jsonb)', 'execute'),
  false,
  'authenticated cannot execute sync_push_batch (retired bypass)'
);

-- 4-5. Operation RPCs are authenticated-only (no anon/public execute).
SELECT is(
  has_function_privilege('anon', 'public.submit_case_operation(text, text, uuid, jsonb)', 'execute'),
  false,
  'anon cannot execute submit_case_operation'
);
SELECT is(
  has_function_privilege('anon', 'public.relabel_case_mode(uuid, boolean, text)', 'execute'),
  false,
  'anon cannot execute relabel_case_mode'
);

-- 6-7. Operation log + audit outbox are RLS-gated (RPC/service-role only).
SELECT ok(
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'case_operation_log' AND rowsecurity),
  'case_operation_log has RLS enabled'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_outbox' AND rowsecurity),
  'audit_outbox has RLS enabled'
);

ROLLBACK;
