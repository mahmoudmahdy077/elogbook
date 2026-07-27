-- GATE2-001: Enforce Free plan 20-case limit at the DB level
CREATE OR REPLACE FUNCTION public.check_case_quota(p_tenant_id UUID)
RETURNS TABLE(allowed BOOLEAN, current_count BIGINT, max_cases INT, plan_slug TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan_id UUID; v_features JSONB;
BEGIN
  SELECT plan_id INTO v_plan_id FROM subscriptions WHERE tenant_id = p_tenant_id AND status = 'active' LIMIT 1;
  SELECT features INTO v_features FROM subscription_plans WHERE id = v_plan_id;
  v_features := COALESCE(v_features, '{"max_cases": 20}'::JSONB);
  RETURN QUERY
  SELECT
    CASE WHEN (v_features->>'max_cases')::INT = 0 THEN TRUE
         ELSE (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND deleted_at IS NULL) < (v_features->>'max_cases')::INT
    END,
    (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND deleted_at IS NULL),
    (v_features->>'max_cases')::INT,
    (SELECT slug FROM subscription_plans WHERE id = v_plan_id);
END $$;

-- Also add a BEFORE INSERT trigger that blocks over-quota case creation
CREATE OR REPLACE FUNCTION public.enforce_case_quota() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_allowed BOOLEAN; v_max INT;
BEGIN
  SELECT allowed, max_cases INTO v_allowed, v_max FROM public.check_case_quota(NEW.tenant_id);
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Free plan limit reached (%)%. Upgrade to log more cases.', v_max;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_enforce_case_quota BEFORE INSERT ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_case_quota();
