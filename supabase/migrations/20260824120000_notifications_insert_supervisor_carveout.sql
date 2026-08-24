-- ============================================================================
-- FIX: approval notifications silently dead — notifications INSERT policy drift.
--
-- Found Cycle 41: supervisor → resident notification INSERT = 42501, while
-- self-inserts work. The remote policy only allows user_id = auth.uid()
-- (the 00083 FOR ALL policy); the intended supervisor+ carve-out from
-- 20260812130000 (target OR supervisor+) is not in effect on the remote.
--
-- Impact: apps/web approvals route inserts the "Case approved/rejected"
-- notification as the SUPERVISOR — it fails RLS and the route ignores the
-- error (.maybeSingle() unchecked), so residents never receive approval
-- notifications.
--
-- Fix: re-assert the intended policy explicitly:
--   * target user can insert to themselves
--   * supervisor+ of same tenant can notify any tenant member
--   * keep the FOR ALL ownership policy for SELECT/UPDATE/DELETE
-- ============================================================================

DROP POLICY IF EXISTS notifications_insert_tenant ON public.notifications;

CREATE POLICY notifications_insert_tenant ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      user_id = auth.uid()
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );
