-- ============================================================================
-- 20260825100000_evaluation_forms_select_scoping.sql
--
-- Swarm Wave-1 finding F5 (privacy): evaluation_forms had a single
-- tenant-wide FOR ALL policy, letting any member (including residents) read
-- every evaluation of every resident in the tenant.
--
-- Fix: split policies.
--   SELECT  - subject resident sees own forms, evaluator sees forms they wrote,
--             supervisor+ see tenant-wide (matches Evaluations admin page).
--   INSERT / UPDATE / DELETE - unchanged tenant scoping (evaluator flows,
--             MSF acknowledge by subject resident on own form, mobile sync
--             via SECURITY DEFINER RPC are all preserved).
-- ============================================================================

DROP POLICY IF EXISTS eval_forms_tenant ON public.evaluation_forms;

CREATE POLICY eval_forms_select ON public.evaluation_forms
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

CREATE POLICY eval_forms_insert ON public.evaluation_forms
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY eval_forms_update ON public.evaluation_forms
  FOR UPDATE
  TO authenticated
  USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY eval_forms_delete ON public.evaluation_forms
  FOR DELETE
  TO authenticated
  USING (tenant_id = get_tenant_id());
