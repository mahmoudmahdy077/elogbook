-- M8.2: transactional publish contract (audit_outbox durable queue).
-- Publication audit is part of the same transaction: if the audit_logs
-- insert fails, the event lands in audit_outbox (same txn) for operator
-- drain instead of vanishing into a swallowed exception.
-- NOTE: audit_logs.tenant_id is NOT NULL; platform publishes pass the
-- operator's tenant for attribution. tenant_id must reference tenants(id);
-- callers pass real tenant UUIDs (see pgTAP test p3_02).

CREATE TABLE IF NOT EXISTS public.audit_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  changes JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.audit_outbox ENABLE ROW LEVEL SECURITY;
-- No policies: deny direct reads/writes; service-role drains the queue.

-- M8.2: harden publish_site_page — in-database tenant authorization for
-- tenant-scope pages + transactional audit with durable failure queue.
CREATE OR REPLACE FUNCTION public.publish_site_page(
  p_page_id UUID,
  p_revision_id UUID,
  p_expected_pointer UUID DEFAULT NULL,
  p_expectation_set BOOLEAN DEFAULT FALSE,
  p_actor UUID DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current UUID;
  v_rev_page UUID;
  v_scope TEXT;
  v_page_tenant UUID;
BEGIN
  -- Lock the page row for the duration of the transaction.
  SELECT published_revision_id, scope, tenant_id
    INTO v_current, v_scope, v_page_tenant
  FROM public.site_pages
  WHERE id = p_page_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Tenant authorization lives in the database for tenant-scope pages:
  -- the caller's tenant must own the page. Platform-scope pages rely on
  -- the route's scope pre-check (documented boundary).
  IF v_scope = 'tenant' AND (p_tenant_id IS DISTINCT FROM v_page_tenant) THEN
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = 'P0005';
  END IF;

  -- Optimistic concurrency: stale editors fail closed with 409.
  IF p_expectation_set AND (v_current IS DISTINCT FROM p_expected_pointer) THEN
    RAISE EXCEPTION 'pointer_conflict' USING ERRCODE = 'P0003';
  END IF;

  -- Revision must belong to this page.
  SELECT page_id INTO v_rev_page
  FROM public.site_page_revisions
  WHERE id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_rev_page IS DISTINCT FROM p_page_id THEN
    RAISE EXCEPTION 'revision_mismatch' USING ERRCODE = 'P0004';
  END IF;

  -- Archive the previous pointer (if any and different).
  IF v_current IS NOT NULL AND v_current IS DISTINCT FROM p_revision_id THEN
    UPDATE public.site_page_revisions
    SET status = 'archived'
    WHERE id = v_current;
  END IF;

  UPDATE public.site_page_revisions
  SET status = 'published'
  WHERE id = p_revision_id;

  UPDATE public.site_pages
  SET published_revision_id = p_revision_id, updated_at = NOW()
  WHERE id = p_page_id;

  -- Transactional audit: same-txn insert; on failure the event lands in
  -- the durable outbox (same txn) for operator drain — never swallowed.
  BEGIN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (p_tenant_id, p_actor, 'site_page_publish', 'site_pages', p_page_id, jsonb_build_object('revision_id', p_revision_id));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.audit_outbox (tenant_id, user_id, action, resource_type, resource_id, changes, error)
    VALUES (p_tenant_id, p_actor, 'site_page_publish', 'site_pages', p_page_id, jsonb_build_object('revision_id', p_revision_id), SQLERRM);
  END;

  RETURN p_revision_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_site_page(UUID, UUID, UUID, BOOLEAN, UUID, UUID) FROM PUBLIC, anon, authenticated;
