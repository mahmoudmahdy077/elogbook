DROP TRIGGER IF EXISTS trg_scan_field_values_phi ON public.case_entries;
DROP FUNCTION IF EXISTS public.scan_field_values_for_phi();

CREATE OR REPLACE FUNCTION public.field_values_contain_phi(p_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_key TEXT;
  v_child JSONB;
  v_text TEXT;
  v_allowed TEXT[] := ARRAY[
    'age_group', 'anesthesia', 'anesthesia_type', 'approach', 'body_part', 'body_region',
    'case_type', 'clinical_details', 'clinical_indication', 'clinical_notes', 'comparison_studies',
    'complexity', 'comorbidity', 'comorbidities', 'complication', 'complications', 'contrast_used',
    'description', 'diagnosis', 'duration_minutes', 'findings', 'follow_up', 'impression', 'indication',
    'level', 'location', 'modality', 'notes', 'outcome', 'procedure', 'procedure_code', 'procedure_name',
    'role', 'setting', 'specialty', 'status', 'summary', 'supervised', 'supervision_level', 'technique',
    'teaching', 'urgent', 'urgency'
  ];
BEGIN
  IF p_value IS NULL THEN
    RETURN FALSE;
  END IF;

  IF jsonb_typeof(p_value) = 'object' THEN
    FOR v_key, v_child IN
      SELECT key, value FROM jsonb_each(p_value)
    LOOP
      IF lower(regexp_replace(v_key, '[^a-zA-Z0-9]', '', 'g')) <> ALL (v_allowed) THEN
        RETURN TRUE;
      END IF;
      IF public.field_values_contain_phi(v_child) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
    RETURN FALSE;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    FOR v_child IN SELECT value FROM jsonb_array_elements(p_value)
    LOOP
      IF public.field_values_contain_phi(v_child) THEN
        RETURN TRUE;
      END IF;
    END LOOP;
    RETURN FALSE;
  END IF;

  v_text := p_value::text;
  RETURN v_text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    OR v_text ~ '\m\d{3}-\d{2}-\d{4}\M'
    OR v_text ~ '\m\d{3}[ -]\d{2}[ -]\d{4}\M'
    OR v_text ~* '\m(?:mrn|medical\s+record(?:\s+number)?|patient\s+record)\s*[:#=-]?\s*[A-Z0-9-]{4,}\M'
    OR v_text ~ '\m\d{6,}\M'
    OR v_text ~ '\m\d{4}-\d{2}-\d{2}\M'
    OR v_text ~ '\m\d{2}/\d{2}/\d{4}\M'
    OR v_text ~* '\m\d{1,5}\s+[A-Z][A-Z.-]*(?:\s+[A-Z][A-Z.-]*){0,4}\s+(?:STREET|ST|ROAD|RD|AVENUE|AVE|BOULEVARD|BLVD|LANE|LN|DRIVE|DR|COURT|CT|WAY|TERRACE|PLACE|PL)\M'
    OR v_text ~* '\m(?:Dr|Mr|Mrs|Ms|Miss)\.?\s+[A-Z][A-Z-]+(?:\s+[A-Z][A-Z-]+)+\M'
    OR v_text ~* '\m(?:patient|resident)\s+[A-Z][A-Z-]+(?:\s+[A-Z][A-Z-]+)+\M'
    OR (
      v_text ~ '\m[A-Z][a-z]{1,30}\s+[A-Z][a-z]{1,30}\M'
      AND v_text !~* '\m(?:laparoscopic|appendectomy|surgery|medical|clinical|patient|resident|case|general|internal|medicine|emergency|cardiology|orthopedic|pediatric|neurology|recovery|hospital|clinic|institution|department|program|template|logbook|quality|assessment|service|system|follow[- ]?up|outpatient|inpatient|diagnos[a-z]*|procedure|treatment|therapy|anesthesia|complication|my|new|the|this)\M'
    );
END;
$$;

CREATE FUNCTION public.scan_field_values_for_phi() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.is_deidentified = true AND public.field_values_contain_phi(NEW.field_values) THEN
    RAISE EXCEPTION 'PHI detected in deidentified field values';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_scan_field_values_phi
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();

REVOKE ALL ON FUNCTION public.field_values_contain_phi(JSONB) FROM PUBLIC, anon, authenticated;
