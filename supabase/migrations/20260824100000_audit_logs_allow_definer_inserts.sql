-- ============================================================================
-- FIX: audit_logs INSERT block policy broke audited-table writes.
--
-- Found Cycle 27: director cannot create program goals — 42501 on audit_logs.
-- Chain: trg_audit_program_goals (AFTER INSERT) → audit_table_change() is
-- SECURITY DEFINER (postgres, table owner) → 00049 set FORCE RLS on
-- audit_logs, so the owner ALSO evaluates policies → 00012's
-- "Block all authenticated INSERTs" WITH CHECK (false) TO authenticated is
-- the only INSERT policy... and under FORCE+definer the write is evaluated
-- against it → every audited insert that runs in definer context dies.
--
-- Fix: keep blocking end-user-forged audit rows, but allow server-side
-- (SECURITY DEFINER) writes — those run with auth.uid() IS NULL:
--   WITH CHECK (auth.uid() IS NULL)
-- Client JWTs always carry a uid; definer context has none. This restores
-- 00012's security intent while unbreaking goal creation (and any other
-- audited table whose trigger path hits this).
-- ============================================================================

DROP POLICY IF EXISTS "Block all authenticated INSERTs on audit_logs" ON public.audit_logs;

CREATE POLICY "Only server-side (definer) inserts on audit_logs"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NULL);
