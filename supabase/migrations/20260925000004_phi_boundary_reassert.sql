CREATE OR REPLACE FUNCTION public.ai_text_contains_phi(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    p_text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
    OR p_text ~ '\+?\d[\d(). -]{7,}\d'
    OR p_text ~* '\m\d{1,5}\s+[A-Z][A-Z.-]*(?:\s+[A-Z][A-Z.-]*){0,4}\s+(?:STREET|ST|ROAD|RD|AVENUE|AVE|BOULEVARD|BLVD|LANE|LN|DRIVE|DR|COURT|CT|WAY|TERRACE|PLACE|PL)\M'
    OR p_text ~* '\mP\.?\s*O\.?\s+BOX\s+\d+\M'
    OR p_text ~ '\m(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\M'
    OR p_text ~ '\m\d{3}[- ]\d{2}[- ]\d{4}\M'
    OR p_text ~* '\m(?:MRN|MEDICAL\s+RECORD(?:\s+NUMBER)?|PATIENT\s+RECORD)\s*[:#=-]?\s*[A-Z0-9][A-Z0-9-]{3,}\M'
    OR p_text ~ '\m\d{6,}\M'
    OR p_text ~* '\m(?:Dr|Mr|Mrs|Ms|Miss)\.?\s+[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)+\M'
    OR p_text ~* '\m[A-Z][A-Za-z-]+,\s*[A-Z][A-Za-z-]+\M'
    OR (
      p_text ~ '\m[A-Z][a-z]{1,30}\s+[A-Z][a-z]{1,30}\M'
      AND p_text !~* '\m(?:laparoscopic|appendectomy|surgery|medical|clinical|patient|resident|case|general|internal|medicine|emergency|cardiology|orthopedic|pediatric|neurology|recovery|hospital|clinic|institution|department|program|template|logbook|quality|assessment|service|system|follow[- ]?up|outpatient|inpatient|diagnos[a-z]*|procedure|treatment|therapy|anesthesia|complication|my|new|the|this|age|group|adult|child|infant|neonate|older)\M'
    )
  , FALSE);
$$;

CREATE OR REPLACE FUNCTION public.ai_field_value_is_safe(p_value JSONB, p_field_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_child JSONB;
  v_text TEXT;
BEGIN
  IF p_field_key = ANY (ARRAY[
    'clinicaldetails', 'clinicalindication', 'clinicalnotes', 'description', 'diagnosis',
    'findings', 'followup', 'impression', 'indication', 'notes', 'summary'
  ]) THEN
    RETURN jsonb_typeof(p_value) = 'boolean';
  END IF;

  IF p_field_key = ANY (ARRAY['supervised', 'teaching', 'urgent']) THEN
    RETURN jsonb_typeof(p_value) = 'boolean';
  END IF;

  IF p_field_key = ANY (ARRAY['durationminutes', 'procedurecode']) THEN
    IF jsonb_typeof(p_value) <> 'number' OR p_value::text !~ '^\d+$' THEN RETURN FALSE; END IF;
    IF p_field_key = 'durationminutes' AND (p_value::text)::numeric > 1440 THEN RETURN FALSE; END IF;
    IF p_field_key = 'procedurecode' AND (p_value::text)::numeric > 100000 THEN RETURN FALSE; END IF;
    RETURN NOT public.ai_text_contains_phi(p_value::text);
  END IF;

  IF p_field_key = ANY (ARRAY[
    'comparisonstudies', 'comorbidities', 'complications'
  ]) THEN
    IF jsonb_typeof(p_value) <> 'array' OR jsonb_array_length(p_value) < 1 OR jsonb_array_length(p_value) > 8 THEN RETURN FALSE; END IF;
    FOR v_child IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(v_child) <> 'string' THEN RETURN FALSE; END IF;
      v_text := v_child #>> '{}';
      IF char_length(v_text) < 1 OR char_length(v_text) > 64 OR v_text !~ '^[A-Za-z0-9][A-Za-z0-9 _./+()-]{0,63}$' THEN RETURN FALSE; END IF;
      IF public.ai_text_contains_phi(v_text) THEN RETURN FALSE; END IF;
    END LOOP;
    RETURN TRUE;
  END IF;

  IF p_field_key = ANY (ARRAY[
    'agegroup', 'anesthesia', 'anesthesiatype', 'approach', 'bodypart', 'bodyregion',
    'casetype', 'complexity', 'comorbidity', 'complication', 'contrastused', 'level',
    'location', 'modality', 'outcome', 'procedure', 'procedurename', 'role', 'setting',
    'specialty', 'status', 'supervisionlevel', 'technique', 'urgency'
  ]) THEN
    IF jsonb_typeof(p_value) <> 'string' THEN RETURN FALSE; END IF;
    v_text := p_value #>> '{}';
    IF char_length(v_text) < 1 OR char_length(v_text) > 64 OR v_text !~ '^[A-Za-z0-9][A-Za-z0-9 _./+()-]{0,63}$' THEN RETURN FALSE; END IF;
    RETURN NOT public.ai_text_contains_phi(v_text);
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.field_values_contain_phi(p_value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_key TEXT;
  v_normalized_key TEXT;
  v_child JSONB;
  v_allowed TEXT[] := ARRAY[
    'agegroup', 'anesthesia', 'anesthesiatype', 'approach', 'bodypart', 'bodyregion',
    'casetype', 'clinicaldetails', 'clinicalindication', 'clinicalnotes', 'comparisonstudies',
    'complexity', 'comorbidity', 'comorbidities', 'complication', 'complications', 'contrastused',
    'description', 'diagnosis', 'durationminutes', 'findings', 'followup', 'impression', 'indication',
    'level', 'location', 'modality', 'notes', 'outcome', 'procedure', 'procedurecode', 'procedurename',
    'role', 'setting', 'specialty', 'status', 'summary', 'supervised', 'supervisionlevel', 'technique',
    'teaching', 'urgent', 'urgency'
  ];
BEGIN
  IF p_value IS NULL THEN RETURN FALSE; END IF;
  IF jsonb_typeof(p_value) = 'object' THEN
    FOR v_key, v_child IN SELECT key, value FROM jsonb_each(p_value) LOOP
      v_normalized_key := lower(regexp_replace(v_key, '[^a-zA-Z0-9]', '', 'g'));
      IF v_normalized_key <> ALL (v_allowed) THEN RETURN TRUE; END IF;
      IF NOT public.ai_field_value_is_safe(v_child, v_normalized_key) THEN RETURN TRUE; END IF;
      IF jsonb_typeof(v_child) IN ('object', 'array') AND public.field_values_contain_phi(v_child) THEN RETURN TRUE; END IF;
    END LOOP;
    RETURN FALSE;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    FOR v_child IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF public.field_values_contain_phi(v_child) THEN RETURN TRUE; END IF;
    END LOOP;
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.is_deidentified = true AND public.field_values_contain_phi(NEW.field_values) THEN
    RAISE EXCEPTION 'PHI detected in deidentified field values';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scan_field_values_phi ON public.case_entries;
CREATE TRIGGER trg_scan_field_values_phi
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();

REVOKE ALL ON FUNCTION public.ai_text_contains_phi(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_field_value_is_safe(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.field_values_contain_phi(JSONB) FROM PUBLIC, anon, authenticated;
