-- 20260812120000_fix_duty_faculty_rls.sql
-- S3: policies never referenced the caller. Bind every read/write to the
-- caller's own tenant and require a legitimate actor for writes.

DROP POLICY IF EXISTS duty_periods_tenant_isolation ON public.duty_periods;

CREATE POLICY duty_periods_tenant_isolation ON public.duty_periods
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1)
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS faculty_evals_tenant_isolation ON public.faculty_evaluations;

CREATE POLICY faculty_evals_tenant_isolation ON public.faculty_evaluations
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );
