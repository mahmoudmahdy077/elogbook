-- ============================================================================
-- 20260825030000_goal_progress_count_global_templates.sql
--
-- Swarm Wave-1 finding F4 (P3 logic): recalc_goal_progress only matched
-- specialty templates owned by the tenant (ct.tenant_id = v_tenant_id), so
-- cases logged against GLOBAL templates never counted toward a resident's
-- specialty goal. Demo tenant owns zero templates => every case was invisible
-- to goals until the goal's specialty was nulled.
--
-- Fix: match specialty templates from the tenant OR the global tenant.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recalc_goal_progress()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_resident_id UUID := NEW.resident_id; v_tenant_id UUID := NEW.tenant_id;
BEGIN
  INSERT INTO goal_progress (goal_id, resident_id, current_count, last_updated)
  SELECT pg.id, v_resident_id, COUNT(ce.id), NOW()
  FROM program_goals pg
  LEFT JOIN case_entries ce ON ce.resident_id = pg.resident_id
    AND ce.tenant_id = v_tenant_id
    AND ce.status = 'approved'
    AND ce.deleted_at IS NULL
    AND (
      pg.specialty IS NULL
      OR ce.template_id IN (
        SELECT id FROM public.case_templates
        WHERE specialty = pg.specialty
          AND tenant_id IN (v_tenant_id, '00000000-0000-0000-0000-000000000000')
      )
    )
  WHERE pg.resident_id = v_resident_id AND pg.tenant_id = v_tenant_id
  GROUP BY pg.id
  ON CONFLICT (goal_id) DO UPDATE SET current_count = EXCLUDED.current_count, last_updated = NOW();
  RETURN NEW;
END $$;
