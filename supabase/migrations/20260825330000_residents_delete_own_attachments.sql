-- ============================================================================
-- 20260825330000_residents_delete_own_attachments.sql
--
-- Swarm Wave-5 gap found while wiring the attachments UI: case_attachments
-- had INSERT/SELECT/DELETE(supervisor+) policies but NO delete path for the
-- uploading resident — an uploader could never remove their own file.
--
-- Fix: allow the uploading resident to delete their own attachment metadata,
-- tenant-scoped. (Storage object removal is separately authorized by the
-- storage.objects tenant-folder policies added in 20260825260000.)
-- ============================================================================

CREATE POLICY "Residents delete own case attachments"
  ON public.case_attachments
  FOR DELETE
  TO authenticated
  USING (
    uploaded_by = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
  );
