-- ============================================================================
-- FIX: quota trigger blocked sync upserts of EXISTING rows.
--
-- Found Cycle 7: with tenant at plan cap, sync_push_batch upsert of an
-- EXISTING case (tombstone/field update) raised 'Free plan limit reached'
-- because ON CONFLICT DO UPDATE still runs BEFORE INSERT triggers before
-- conflict detection. An update to an existing case is not new usage and
-- must not count against quota.
--
-- Fix: skip enforcement when NEW.id already exists (i.e., this INSERT will
-- conflict into an UPDATE). New-case creation remains fully enforced.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_case_quota()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_allowed BOOLEAN;
  v_max INT;
BEGIN
  -- Updating an existing row via INSERT ... ON CONFLICT (offline sync) is
  -- not new usage — only genuinely new cases consume quota.
  IF EXISTS (SELECT 1 FROM public.case_entries WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT allowed, max_cases INTO v_allowed, v_max
  FROM public.check_case_quota(NEW.tenant_id);
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Free plan limit reached (%). Upgrade to log more cases.', v_max;
  END IF;
  RETURN NEW;
END $$;
