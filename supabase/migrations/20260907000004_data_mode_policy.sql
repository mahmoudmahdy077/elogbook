-- ============================================================================
-- 20260907000004_data_mode_policy.sql (T19)
--
-- Dual patient-data mode policy (section 4.2). Effective identifiable mode
-- requires ALL of: installation qualified (phi_ready) AND installation
-- ceiling (allow_identifiable) AND tenant ceiling AND tenant request. Any
-- unknown value or failed lookup denies identifiable writes.
--
-- Enforcement is transactional in Postgres (fires for direct REST, RPCs,
-- imports, jobs, and privileged paths alike). Switching a tenant back to
-- de-identified stops NEW identifiable records; existing identifiable rows
-- keep their classification and remain editable for non-identifier fields
-- (restricted historical workflow); nothing is auto-cleared or relabeled.
--
-- Known limit (documented, not hidden): policy is evaluated per row at
-- write time. A revocation racing an in-flight transaction does not abort
-- it; revocation governs all subsequent writes. Predicate locking is
-- T19-full work. Identifiable production enablement still requires G8.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.installation_policy (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  phi_ready BOOLEAN NOT NULL DEFAULT FALSE,
  allow_identifiable BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO public.installation_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.installation_policy ENABLE ROW LEVEL SECURITY;
-- No policies: deny direct reads/writes; server-side code uses service role.

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS data_mode_requested TEXT NOT NULL DEFAULT 'deidentified'
  CHECK (data_mode_requested IN ('deidentified', 'identifiable'));
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS allow_identifiable BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS data_policy_version INT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.tenant_identifiable_allowed(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inst RECORD;
  v_tenant RECORD;
BEGIN
  SELECT phi_ready, allow_identifiable INTO v_inst FROM public.installation_policy WHERE id = 1;
  IF NOT FOUND OR NOT COALESCE(v_inst.phi_ready, FALSE) OR NOT COALESCE(v_inst.allow_identifiable, FALSE) THEN
    RETURN FALSE;
  END IF;
  SELECT allow_identifiable, data_mode_requested INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  RETURN COALESCE(v_tenant.allow_identifiable, FALSE) AND v_tenant.data_mode_requested = 'identifiable';
EXCEPTION WHEN OTHERS THEN
  -- Any failed lookup denies identifiable writes (fail closed).
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_data_mode()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- De-identified rows: record-level CHECK (deidentified_no_phi) governs.
  IF COALESCE(NEW.is_deidentified, TRUE) THEN RETURN NEW; END IF;

  -- Update path for historical identifiable rows while policy is off:
  -- non-identifier edits stay possible; identifiers cannot be added or
  -- altered, and rows cannot be flipped back to identifiable.
  IF TG_OP = 'UPDATE' AND OLD.is_deidentified IS NOT DISTINCT FROM FALSE THEN
    IF public.tenant_identifiable_allowed(NEW.tenant_id) THEN RETURN NEW; END IF;
    IF NEW.patient_mrn IS DISTINCT FROM OLD.patient_mrn
       OR NEW.patient_dob IS DISTINCT FROM OLD.patient_dob THEN
      RAISE EXCEPTION 'identifier edits require identifiable-data permission for this tenant'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- New identifiable records (INSERT, or flips to identifiable) need permission.
  IF NOT public.tenant_identifiable_allowed(NEW.tenant_id) THEN
    RAISE EXCEPTION 'identifiable records are not permitted for this tenant (de-identified mode)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_data_mode ON public.case_entries;
CREATE TRIGGER trg_enforce_data_mode
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_data_mode();
