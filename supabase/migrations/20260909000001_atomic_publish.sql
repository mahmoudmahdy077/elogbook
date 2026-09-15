-- M8: atomic site-page publication (local-first enterprise carry-forward).
-- Replaces read-then-independent-writes with one transactional CAS:
-- locks the page row, checks the expected pointer, archives the old
-- revision, publishes the new revision, moves the pointer, audits.
-- Concurrent publishers converge: exactly one wins, the other gets 409.

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
  v_page_rev_page UUID;
  v_rev_page UUID;
BEGIN
  -- Lock the page row for the duration of the transaction.
  SELECT published_revision_id INTO v_current
  FROM public.site_pages
  WHERE id = p_page_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0002';
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

  BEGIN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (p_tenant_id, p_actor, 'site_page_publish', 'site_pages', p_page_id, jsonb_build_object('revision_id', p_revision_id));
  EXCEPTION WHEN OTHERS THEN
    -- Audit is best-effort; publication must not fail because of it.
    NULL;
  END;

  RETURN p_revision_id;
END;
$$;

-- Service-role only: no public execute grant (routes use service-role client).
REVOKE ALL ON FUNCTION public.publish_site_page(UUID, UUID, UUID, BOOLEAN, UUID, UUID) FROM PUBLIC, anon, authenticated;
