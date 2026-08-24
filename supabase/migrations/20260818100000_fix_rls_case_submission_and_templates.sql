-- ============================================================================
-- FIX: RLS policies for case submission and global templates
-- ============================================================================

-- Drop ALL existing resident UPDATE policies on case_entries
DROP POLICY IF EXISTS "Resident updates own draft entries only" ON public.case_entries;
DROP POLICY IF EXISTS "residents update own draft or rejected entries" ON public.case_entries;

-- Create a single, correct policy for residents
CREATE POLICY "residents update own draft or rejected entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status IN ('draft', 'rejected')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status IN ('draft', 'pending')
  );

-- ============================================================================
-- FIX: Allow residents to see global templates
-- ============================================================================

DROP POLICY IF EXISTS "Tenant members can read templates" ON public.case_templates;

CREATE POLICY "Tenant members can read templates"
  ON case_templates FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    OR tenant_id = '00000000-0000-0000-0000-000000000000'
  );
