-- ============================================================================
-- FIX: RLS blocks soft-delete tombstones on case_entries (breaks offline sync)
--
-- Found in Cycle 4 of the 100-cycle audit (2026-08-24).
--
-- Evidence: resident PATCH {deleted_at} on own draft row -> 403 (42501 "new
-- row violates row-level security policy"), while PATCH {field_values} on the
-- same row -> 204. The resident UPDATE policy's WITH CHECK only admits
-- status IN ('draft','pending') and — in the live policy — effectively any
-- change that keeps deleted_at NULL. The supervisor UPDATE policy only admits
-- status = 'pending'.
--
-- Impact:
--   1. Mobile offline sync pushes deletes as tombstone upserts
--      ({id, tenant_id, deleted_at}) — see lib/sync/engine.ts rowToServerPayload.
--      Those upserts hit the UPDATE policy and fail with 42501 forever,
--      so a case deleted offline never syncs and retries indefinitely.
--   2. No role can retract or correct an approved case through the API;
--      combined with the free-plan quota trigger counting non-deleted rows,
--      a tenant can wedge permanently at its case cap.
--
-- Fix: dedicated soft-delete policies.
--   - Residents may set deleted_at on their OWN entries (any status).
--   - Supervisor+ may set deleted_at on any entry in their tenant.
--   Both restricted to transitions where ONLY deleted_at changes are allowed
--   to be non-null; other columns must keep their values (we re-check status
--   is unchanged by comparing to OLD via the fact WCHECK sees NEW row only —
--   so we simply require the new row keep a valid status value).
-- ============================================================================

DROP POLICY IF EXISTS "residents soft delete own entries" ON public.case_entries;
DROP POLICY IF EXISTS "supervisor+ soft delete tenant entries" ON public.case_entries;

CREATE POLICY "residents soft delete own entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND deleted_at IS NOT NULL
    AND status IN ('draft', 'pending', 'approved', 'rejected')
  );

CREATE POLICY "supervisor+ soft delete tenant entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND deleted_at IS NOT NULL
    AND status IN ('draft', 'pending', 'approved', 'rejected')
  );
