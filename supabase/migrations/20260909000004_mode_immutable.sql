-- ============================================================================
-- 20260909000004_mode_immutable.sql (N1)
--
-- Data-mode relabeling decision: is_deidentified is IMMUTABLE after row
-- creation. The prior trigger returned early for de-identified NEW rows,
-- silently permitting identifiable->de-identified relabels. A relabel
-- contradicts mode history and can strand PHI semantics, so it is rejected
-- at the row level with a clear error. The ONLY legal path is the audited
-- relabel_case_mode() RPC below (supervisor+, own tenant, identifiers
-- already NULL when moving to de-identified, mandatory reason, audit row —
-- history is preserved, never rewritten).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.forbid_mode_relabel()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Transaction-local exemption for the audited relabel RPC below (the flag
  -- dies with the transaction; ordinary writes can never set it).
  IF current_setting('app.mode_relabel', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.is_deidentified IS DISTINCT FROM OLD.is_deidentified THEN
    RAISE EXCEPTION 'policy: mode_immutable: is_deidentified cannot change after creation (use relabel_case_mode)'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_mode_relabel ON public.case_entries;
CREATE TRIGGER trg_forbid_mode_relabel
  BEFORE UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mode_relabel();

CREATE OR REPLACE FUNCTION public.relabel_case_mode(
  p_row_id UUID,
  p_to_deidentified BOOLEAN,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
  v_row case_entries;
BEGIN
  IF p_row_id IS NULL OR p_reason IS NULL OR char_length(p_reason) < 8 THEN
    RAISE EXCEPTION 'invalid relabel request (row + reason >= 8 chars required)' USING ERRCODE = 'P0004';
  END IF;

  SELECT id, tenant_id, role INTO v_profile_id, v_tenant_id, v_role
    FROM public.profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: profile_not_found');
  END IF;
  IF v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: forbidden');
  END IF;

  SELECT * INTO v_row FROM public.case_entries
   WHERE id = p_row_id AND tenant_id = v_tenant_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_row.is_deidentified IS NOT DISTINCT FROM p_to_deidentified THEN
    RETURN jsonb_build_object('success', true, 'unchanged', true, 'id', v_row.id);
  END IF;

  -- Moving TO de-identified with identifiers present would silently strand
  -- PHI semantics: refuse and require explicit identifier clearance first.
  IF p_to_deidentified AND (v_row.patient_mrn IS NOT NULL OR v_row.patient_dob IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: identifiers_present');
  END IF;
  -- Moving TO identifiable requires the tenant ceiling.
  IF NOT p_to_deidentified AND NOT public.tenant_identifiable_allowed(v_tenant_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: identifiable_not_permitted');
  END IF;

  PERFORM set_config('app.mode_relabel', 'on', true);
  UPDATE public.case_entries SET is_deidentified = p_to_deidentified WHERE id = v_row.id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (v_tenant_id, auth.uid(), 'case_relabel', 'case_entries', v_row.id,
          jsonb_build_object('from', v_row.is_deidentified, 'to', p_to_deidentified, 'reason', LEFT(p_reason, 500)));

  RETURN jsonb_build_object('success', true, 'id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.relabel_case_mode(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.relabel_case_mode(UUID, BOOLEAN, TEXT) TO authenticated;
