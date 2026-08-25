-- ============================================================================
-- 20260825260000_storage_case_attachments_policies.sql
--
-- Swarm Wave-4: wire the previously-unwired case-attachments scaffold.
-- Bucket `case-attachments` (private) existed with ZERO permissive policies,
-- so authenticated uploads were impossible.
--
-- Object path convention (enforced by policy, consumed by future UI):
--   <tenant-slug>/<case-id>/<filename>
--
-- Access model mirrors case_attachments table RLS:
--   SELECT   : any authenticated member of the tenant owning the folder
--   INSERT   : same (residents attach to their cases; supervisors likewise)
--   UPDATE   : same
--   DELETE   : same (deletion is additionally mediated app-side / service
--              role for moderation)
-- ============================================================================

-- helper: caller's tenant slug (single scan, reused by all four policies)
CREATE OR REPLACE FUNCTION public.current_tenant_slug()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.slug FROM public.tenants t WHERE t.id = get_tenant_id();
$$;

CREATE POLICY "case_att_select_tenant_folder" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = current_tenant_slug()
  );

CREATE POLICY "case_att_insert_tenant_folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = current_tenant_slug()
  );

CREATE POLICY "case_att_update_tenant_folder" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = current_tenant_slug()
  )
  WITH CHECK (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = current_tenant_slug()
  );

CREATE POLICY "case_att_delete_tenant_folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'case-attachments'
    AND (storage.foldername(name))[1] = current_tenant_slug()
  );
