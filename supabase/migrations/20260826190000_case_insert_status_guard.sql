-- 20260826190000_case_insert_status_guard.sql
-- SEC-002: INSERT bypasses the case status state machine.
--
-- enforce_case_status_transition() (00011) fires BEFORE UPDATE only, so the
-- legal pending -> approved path is guarded but the INSERT path is not.
-- Verified live: a RESIDENT session POSTed case_entries with
-- status='approved' and got 201 — self-approval, skipping supervisor
-- sign-off entirely (the audit_logs row confirms status 'approved' at
-- insert). The web UI hardcodes initialStatus='approved' too
-- (cases/new/page.tsx) which is product-intended for individual tenants
-- but the DB must not trust the client for institution tenants.
--
-- Fix: BEFORE INSERT trigger mirroring the transition rules' INSERT half:
--   - 'individual' tenants: auto-approve (existing behavior,
--     auto_approve_individual already does this — keep for redundancy).
--   - everyone else: 'approved'/'rejected'/'acknowledged' etc. may only be
--     inserted by supervisors/directors/admins of the same tenant
--     (resolved from profiles.user_id = auth.uid()).
--   - residents (and anyone else): forced to 'pending'.
--
-- SECURITY DEFINER + search_path locked so the profile lookup bypasses RLS
-- without leaking definer context to expressions. WHEN pg_trigger_depth()=0
-- keeps sync RPCs and service-role batches governed by their own rules
-- (they already tenant-check inside the RPC).

CREATE OR REPLACE FUNCTION enforce_case_insert_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role TEXT;
  v_tenant_type TEXT;
BEGIN
  SELECT tenant_type INTO v_tenant_type
    FROM public.tenants WHERE id = NEW.tenant_id;

  IF v_tenant_type = 'individual' THEN
    RETURN NEW; -- auto-approve trigger already sets approved; allow through
  END IF;

  IF NEW.status IN ('approved', 'rejected', 'acknowledged') THEN
    SELECT role INTO v_caller_role
      FROM public.profiles
     WHERE user_id = auth.uid()
       AND tenant_id = NEW.tenant_id
     LIMIT 1;

    IF v_caller_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      RAISE EXCEPTION
        'SEC-002: only supervisors+ may insert pre-approved/rejected cases (role=%)',
        COALESCE(v_caller_role, 'none');
    END IF;
    RETURN NEW;
  END IF;

  -- pending/draft inserts: fine for any role; force institutional residents
  -- to an auditable queue state rather than trusting the client.
  IF NEW.status NOT IN ('pending', 'draft') THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_insert_status ON public.case_entries;
CREATE TRIGGER trg_case_insert_status
  BEFORE INSERT ON public.case_entries
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION enforce_case_insert_status();

COMMENT ON FUNCTION enforce_case_insert_status() IS
  'SEC-002: INSERT-side guard for the case status state machine. Residents cannot self-approve via INSERT; supervisors+ of the same tenant can. Individual tenants auto-approve as before.';
