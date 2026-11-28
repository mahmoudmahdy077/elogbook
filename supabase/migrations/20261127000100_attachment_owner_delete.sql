-- 20261127000100_attachment_owner_delete.sql
--
-- Mobile parity for attachments: storage already lets the uploader delete the
-- object (20261126000300), but the table policy still only admitted
-- supervisor+, so a resident's "delete" removed the file and left a broken
-- attachment row. Align the table with the storage rule.
--
-- destructive: no — one policy replaced.

DROP POLICY IF EXISTS "Supervisor+ can delete attachments in tenant" ON public.case_attachments;
DROP POLICY IF EXISTS "Owner or supervisor can delete case attachments" ON public.case_attachments;

CREATE POLICY "Owner or supervisor can delete case attachments" ON public.case_attachments
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      uploaded_by = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND p.tenant_id = case_attachments.tenant_id
          AND p.role IN ('supervisor', 'director', 'institution_admin', 'admin')
          AND p.status = 'active'
      )
    )
  );
