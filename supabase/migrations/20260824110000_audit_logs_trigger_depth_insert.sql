-- ============================================================================
-- FIX v2: audit_logs INSERT policy — distinguish trigger writes from client writes.
--
-- v1 (auth.uid() IS NULL) failed: SECURITY DEFINER triggers still see the
-- caller's JWT (request.jwt.claims is request-scoped), so auth.uid() returns
-- the director's id inside the trigger and the insert stayed blocked.
--
-- Correct discriminator: pg_trigger_depth(). A direct client INSERT via
-- PostgREST runs at depth 0; an INSERT issued from inside a BEFORE/AFTER
-- trigger (the audit path) runs at depth >= 1.
--
--   WITH CHECK (pg_trigger_depth() >= 1)
--
-- Client-forged audit rows remain impossible; trigger-generated audit rows
-- succeed regardless of which authenticated role caused the change.
-- ============================================================================

DROP POLICY IF EXISTS "Only server-side (definer) inserts on audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs inserts only from within triggers" ON public.audit_logs;

CREATE POLICY "audit_logs inserts only from within triggers"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (pg_trigger_depth() >= 1);
