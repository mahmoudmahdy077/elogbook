-- ============================================================================
-- FIX v2: notifications — replace FOR ALL ownership policy with split policies.
--
-- Evidence chain (Cycle 41): supervisor/director → resident notification INSERT
-- 403s even after re-asserting the permissive insert carve-out, while:
--   * self-inserts work,
--   * get_user_role() provably works in WITH CHECK (templates/goals RBAC),
--   * no RESTRICTIVE policies exist in the repo.
-- Conclusion: the remote 00083 `notifications_own` FOR ALL policy is
-- RESTRICTIVE (dashboard drift), AND-ing user_id = auth.uid() into every
-- INSERT — cross-user inserts can never pass regardless of insert_tenant.
--
-- Fix: drop the FOR ALL policy entirely and express ownership as separate
-- permissive SELECT / UPDATE / DELETE policies. INSERT stays with the
-- target-or-supervisor+ carve-out. Permissive policies OR, so the carve-out
-- finally applies.
-- ============================================================================

DROP POLICY IF EXISTS notifications_own ON public.notifications;

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY notifications_delete_own ON public.notifications
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- INSERT policy re-asserted in 20260824120000 (target-or-supervisor+); kept as is.
