-- ============================================================================
-- 20261126000200_tenant_only_policies_to_owner_scope.sql
--
-- Postgres ORs permissive policies, so a blanket `FOR ALL USING
-- tenant_id = get_tenant_id()` policy defeats the narrower owner/role policies
-- defined beside it. Seven tables shipped that pair, which let any tenant
-- member rewrite or delete another member's training record, and three admin
-- tables had no tenant predicate at all.
--
--   1. milestones / shifts / rotations / scholarly_activities / comments /
--      reflections / epa_mappings: replace the tenant-wide ALL policy with
--      per-command policies that check ownership or supervisor+.
--   2. faculty_evaluations / duty_periods: USING was tenant-only, so DELETE
--      (and SELECT) ignored the role; split by command.
--   3. tenant_settings / subscription_changes: the ALL policy checked only the
--      role, so any tenant's institution_admin could read and write every
--      other tenant's rows. Add the tenant predicate.
--   4. custom_plan_features is platform-global; only platform admin may write.
--   5. evaluation_forms INSERT: a resident could file an evaluation about any
--      tenant resident; require resident_id = self unless supervisor+.
--
-- Storage objects for case-attachments are tightened separately in
-- 20261126000300_storage_attachment_owner_scope.sql.
--
-- destructive: no — policies are dropped and recreated; no rows or tables are
-- removed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. comments
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS comments_tenant ON public.comments;

DROP POLICY IF EXISTS comments_select ON public.comments;
CREATE POLICY comments_select ON public.comments
  FOR SELECT TO authenticated
  USING (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS comments_insert ON public.comments;
CREATE POLICY comments_insert ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND author_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS comments_update ON public.comments;
CREATE POLICY comments_update ON public.comments
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      author_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  )
  WITH CHECK (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS comments_delete ON public.comments;
CREATE POLICY comments_delete ON public.comments
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      author_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 2. milestones — assessments are a faculty action
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS milestones_tenant ON public.milestones;

DROP POLICY IF EXISTS milestones_select ON public.milestones;
CREATE POLICY milestones_select ON public.milestones
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS milestones_write ON public.milestones;
CREATE POLICY milestones_write ON public.milestones
  FOR ALL TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- ---------------------------------------------------------------------------
-- 3. shifts — the resident's own duty record, or supervisor+
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS shifts_tenant_isolation ON public.shifts;

DROP POLICY IF EXISTS shifts_owner ON public.shifts;
CREATE POLICY shifts_owner ON public.shifts
  FOR ALL TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. rotations — the existing director policies stay; drop the blanket one and
--    let supervisors and above read the whole tenant.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rotations_tenant_isolation ON public.rotations;

DROP POLICY IF EXISTS rotations_select_supervisor ON public.rotations;
CREATE POLICY rotations_select_supervisor ON public.rotations
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- ---------------------------------------------------------------------------
-- 5. scholarly_activities — own rows, supervisors and above read the tenant
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS scholarly_tenant_isolation ON public.scholarly_activities;

DROP POLICY IF EXISTS scholarly_select_supervisor ON public.scholarly_activities;
CREATE POLICY scholarly_select_supervisor ON public.scholarly_activities
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- ---------------------------------------------------------------------------
-- 6. reflections — the narrow policies already exist; only the blanket one is
--    wrong.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS reflections_tenant_isolation ON public.reflections;

-- ---------------------------------------------------------------------------
-- 7. epa_mappings — tenant configuration, director+ writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS epa_tenant ON public.epa_mappings;

DROP POLICY IF EXISTS epa_select ON public.epa_mappings;
CREATE POLICY epa_select ON public.epa_mappings
  FOR SELECT TO authenticated
  USING (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS epa_write ON public.epa_mappings;
CREATE POLICY epa_write ON public.epa_mappings
  FOR ALL TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

-- ---------------------------------------------------------------------------
-- 8. faculty_evaluations — evaluator or subject, supervisor+ for the tenant
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS faculty_evals_tenant_isolation ON public.faculty_evaluations;

DROP POLICY IF EXISTS faculty_evals_select ON public.faculty_evaluations;
CREATE POLICY faculty_evals_select ON public.faculty_evaluations
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS faculty_evals_insert ON public.faculty_evaluations;
CREATE POLICY faculty_evals_insert ON public.faculty_evaluations
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

DROP POLICY IF EXISTS faculty_evals_update ON public.faculty_evaluations;
CREATE POLICY faculty_evals_update ON public.faculty_evaluations
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  )
  WITH CHECK (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS faculty_evals_delete ON public.faculty_evaluations;
CREATE POLICY faculty_evals_delete ON public.faculty_evaluations
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 9. duty_periods — USING ignored the role, so DELETE was tenant-wide
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS duty_periods_tenant_isolation ON public.duty_periods;

DROP POLICY IF EXISTS duty_periods_owner ON public.duty_periods;
CREATE POLICY duty_periods_owner ON public.duty_periods
  FOR ALL TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 10. tenant_settings / subscription_changes — add the missing tenant predicate
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can manage tenant settings" ON public.tenant_settings;
CREATE POLICY "Admin can manage tenant settings" ON public.tenant_settings
  FOR ALL TO authenticated
  USING (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  )
  WITH CHECK (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  );

DROP POLICY IF EXISTS "Admin can manage subscription changes" ON public.subscription_changes;
CREATE POLICY "Admin can manage subscription changes" ON public.subscription_changes
  FOR ALL TO authenticated
  USING (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  )
  WITH CHECK (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  );

-- custom_plan_features is platform-global: only the platform admin manages it.
DROP POLICY IF EXISTS "Admin can manage custom plan features" ON public.custom_plan_features;
CREATE POLICY "Admin can manage custom plan features" ON public.custom_plan_features
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 11. evaluation_forms — a resident may only file an evaluation about
--     themselves; supervisors and above may evaluate anyone in the tenant.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS eval_forms_insert ON public.evaluation_forms;
CREATE POLICY eval_forms_insert ON public.evaluation_forms
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );
