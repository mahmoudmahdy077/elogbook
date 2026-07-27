CREATE OR REPLACE FUNCTION public.get_template_usage_counts(p_tenant_id UUID, p_resident_id UUID)
RETURNS TABLE(template_id UUID, personal_count BIGINT, tenant_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ct.id, COUNT(ce) FILTER (WHERE ce.resident_id = p_resident_id), COUNT(ce)
  FROM case_templates ct
  LEFT JOIN case_entries ce ON ce.template_id = ct.id AND ce.deleted_at IS NULL
  WHERE ct.tenant_id IN (p_tenant_id, '00000000-0000-0000-0000-000000000000')
  GROUP BY ct.id;
$$;
