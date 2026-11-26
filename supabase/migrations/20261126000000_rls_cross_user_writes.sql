-- ============================================================================
-- 20261126000000_rls_cross_user_writes.sql
--
-- Three policies let a tenant member write or read rows that belong to another
-- member. Each is permissive and only checked `tenant_id`, which is the right
-- tenant boundary but not a role/ownership one.
--
--   1. evaluation_forms INSERT accepted any `evaluator_id`, so a resident could
--      file a completed evaluation with a director as the evaluator, on any
--      resident in the tenant, with any scores.
--   2. evaluation_forms UPDATE had no ownership predicate at all: any tenant
--      member could rewrite any form's scores or residents.
--   3. one_time_purchases INSERT accepted any amount/status, so a resident
--      could self-issue a paid add-on as `completed`/`consumed`.
--   4. case_attachments SELECT was tenant-wide, so a resident could enumerate
--      every other resident's attachment paths; the storage policies authorise
--      download by tenant folder, so the files were reachable too.
--
-- destructive: no — policies are replaced; no row or table is removed.
-- ============================================================================

-- 1 + 2. Evaluations: only the evaluator, or a supervisor and above.
DROP POLICY IF EXISTS eval_forms_insert ON public.evaluation_forms;
CREATE POLICY eval_forms_insert ON public.evaluation_forms
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS eval_forms_update ON public.evaluation_forms;
CREATE POLICY eval_forms_update ON public.evaluation_forms
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

-- 3. Purchases: a client may only open its own pending, unconsumed row.
--    Completion (status/consumed) stays with the gateway webhook (service role).
DROP POLICY IF EXISTS "Users insert own purchases" ON public.one_time_purchases;
CREATE POLICY "Users insert own purchases" ON public.one_time_purchases
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND status = 'pending'
    AND consumed = false
  );

-- 4. Attachments: owners see their own cases; supervisors and above see the tenant.
DROP POLICY IF EXISTS "Tenant members read case attachments" ON public.case_attachments;
CREATE POLICY "Tenant members read case attachments" ON public.case_attachments
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
      OR entry_id IN (
        SELECT ce.id
        FROM public.case_entries ce
        WHERE ce.resident_id IN (
          SELECT p.id FROM public.profiles p WHERE p.user_id = auth.uid()
        )
      )
    )
  );
