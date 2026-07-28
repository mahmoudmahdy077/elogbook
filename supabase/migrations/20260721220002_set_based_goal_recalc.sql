CREATE OR REPLACE FUNCTION public.recalc_goal_progress() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_resident_id UUID := NEW.resident_id; v_tenant_id UUID := NEW.tenant_id;
BEGIN
  INSERT INTO goal_progress (goal_id, resident_id, current_count, last_updated)
  SELECT pg.id, v_resident_id, COUNT(ce.id), NOW()
  FROM program_goals pg
  LEFT JOIN case_entries ce ON ce.resident_id = pg.resident_id
    AND ce.tenant_id = v_tenant_id
    AND ce.status = 'approved'
    AND (pg.specialty IS NULL OR ce.template_id IN (SELECT id FROM case_templates WHERE specialty = pg.specialty AND tenant_id = v_tenant_id))
  WHERE pg.resident_id = v_resident_id AND pg.tenant_id = v_tenant_id
  GROUP BY pg.id
  ON CONFLICT (goal_id) DO UPDATE SET current_count = EXCLUDED.current_count, last_updated = NOW();
  RETURN NEW;
END $$;
