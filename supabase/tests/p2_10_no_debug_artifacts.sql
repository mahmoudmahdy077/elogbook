-- p2_10: no callable debug artifacts in the final schema (T05).
-- Temporary swarm diagnostics must not survive into installs/upgrades.
BEGIN;
SELECT plan(2);

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('debug_exp_tombstone', 'debug_policies_full', 'dbg_cap_deleted', 'debug_swarm_introspect')),
  0,
  'no debug functions remain in public schema'
);

SELECT is(
  (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename = '_swarm_debug_results'),
  0,
  'debug results table is absent'
);

ROLLBACK;
