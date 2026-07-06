-- Migration 00072: Fix RLS asymmetric tenant check in faculty_evaluations
--
-- Issue (P1.3): The faculty_evals_tenant_isolation policy had asymmetric
-- USING/WITH CHECK — USING validates tenant_id against the resident's tenant,
-- but WITH CHECK validates against the evaluator's tenant. This allows an
-- evaluator in tenant A to create an evaluation referencing a resident_id
-- from tenant B, as long as tenant_id matches the evaluator's tenant.
-- Fix: WITH CHECK now also requires evaluator and resident to be in the same tenant.

-- ============================================================
-- Fix: faculty_evaluations RLS — enforce evaluator/resident tenant match
-- ============================================================

DROP POLICY IF EXISTS faculty_evals_tenant_isolation ON faculty_evaluations;

CREATE POLICY faculty_evals_tenant_isolation ON faculty_evaluations
  FOR ALL
  USING (
    -- Read access: user can see evaluations where tenant_id matches the resident's tenant
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id)
  )
  WITH CHECK (
    -- Write access: tenant_id must match the evaluator's tenant
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = evaluator_id)
    -- AND the evaluator and resident must belong to the same tenant
    -- (prevents cross-tenant evaluation creation)
    AND (SELECT tenant_id FROM profiles WHERE id = evaluator_id)
      = (SELECT tenant_id FROM profiles WHERE id = resident_id)
  );

-- Down migration:
-- DROP POLICY IF EXISTS faculty_evals_tenant_isolation ON faculty_evaluations;
-- CREATE POLICY faculty_evals_tenant_isolation ON faculty_evaluations
--   FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id))
--   WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = evaluator_id));
