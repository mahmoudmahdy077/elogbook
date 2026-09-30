-- ============================================================================
-- 20260929000001_admin_user_search_rpc.sql
--
-- Tenant-scoped user search, in the database, where the search term is data.
--
-- Root cause this migration closes
-- ------------------------------
-- The admin user list expressed a name-or-specialty search as
-- `.or('full_name.ilike.%t%,specialty.ilike.%t%')`. That is the only PostgREST
-- shape that means "either column" -- two `.ilike()` calls would AND, hiding
-- everyone whose specialty does not contain the term -- so the combined form was
-- the right tool with the wrong value.
--
-- The value that reaches `.or()` is a filter grammar, not a string: `,`
-- separates clauses, `.` separates a column from its operator, parentheses group,
-- and the LIKE wildcards `%` and `_` have no escape convention in it. The safe
-- move was therefore an allowlist that excluded `'`, `.`, `(`, `)`, `,` and the
-- two wildcards.
--
-- That is safe and wrong. `O'Brien` and `Dr. Smith` are ordinary names, and
-- making them unfindable is indistinguishable to the person searching from making
-- those people not exist. The fix bought a security property with a correctness
-- bug, and the bug is the kind that never gets reported because the workaround
-- ("search by first name") appears to work.
--
-- Design
-- ------
-- public.search_users takes the term as a bound parameter and does the match in
-- SQL, where an apostrophe is an apostrophe and a period is a period:
--
--   * the term is a substring comparison, not a tokenised one. `websearch_to_tsquery`
--     was considered and rejected: it strips the punctuation this exists to keep
--     (`O'Brien` and `Brien` become the same token, `Dr.` loses its period) and it
--     matches whole tokens, so `Brien` would not find `O'Brien` at all. The OR of
--     two `ILIKE`s is the whole requirement.
--
--   * the wildcards are escaped rather than forbidden, so `%` is a character you
--     can search for and not a character that turns the query into `match
--     everything`. The escape character is built with chr(92) so the escaping does
--     not itself depend on standard_conforming_strings.
--
--   * the tenant is resolved from the authoritative principal and then CHECKED
--     against the argument. The argument is not trusted; it is a claim the caller
--     makes, and a claim that disagrees with the principal is refused. The row
--     filter is written against the principal's tenant, never the argument's, so
--     even the failure path cannot read another tenant.
--
--   * page and limit are clamped here as well as in the route. The route's clamp
--     is a courtesy to the caller; this one is the boundary.
--
--   * role and status outside the known set are REFUSED, not ignored. Ignoring one
--     returns a wider result set than the caller asked for, which is a
--     correctness failure in the other direction and the same class of surprise.
--
--   * the projection is the one the list already showed. A definer function that
--     reaches the table directly bypasses the column list, so the column list has
--     to live here too, and the inactive-row predicate the RLS read applied is
--     applied here explicitly.
--
-- Grants: authenticated only. Not anon, not PUBLIC, and not service_role -- a
-- service-role grant on an unreviewed definer is exactly what p1_17 refuses.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_users(
  p_tenant_id UUID,
  p_search TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  tenant_id UUID,
  role TEXT,
  full_name TEXT,
  specialty TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant UUID;
  -- Built with chr(92) rather than a literal so the escaping below behaves the
  -- same whether or not standard_conforming_strings is on.
  v_escape CONSTANT TEXT := chr(92);
  v_term TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_role_filter TEXT := NULLIF(btrim(COALESCE(p_role, '')), '');
  v_status_filter TEXT := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_pattern TEXT;
  v_page INTEGER;
  v_page_size INTEGER;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant scope is required' USING ERRCODE = '42501';
  END IF;

  -- require_active_principal is the shared gate: it checks that there is an
  -- authenticated principal at all, that the profile and tenant are both active,
  -- that the role is one of the two this surface allows, that a platform `admin`
  -- really is one, and that the tenant argument is the caller's own.
  IF NOT public.require_active_principal(
    ARRAY['institution_admin', 'admin']::TEXT[],
    p_tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Read the principal's own tenant back, so the row filter below is written
  -- against the resolved tenant rather than the argument. The gate above has
  -- already established that the two agree; this is the value, not the check.
  SELECT principal.tenant_id
  INTO v_tenant
  FROM public.get_authoritative_principal() AS principal
  LIMIT 1;
  IF NOT FOUND OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Refused, not ignored. See the header.
  IF v_role_filter IS NOT NULL
     AND v_role_filter NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    RAISE EXCEPTION 'unsupported role filter' USING ERRCODE = '22023';
  END IF;
  IF v_status_filter IS NOT NULL
     AND v_status_filter NOT IN ('active', 'inactive', 'pending', 'suspended', 'deactivated') THEN
    RAISE EXCEPTION 'unsupported status filter' USING ERRCODE = '22023';
  END IF;

  -- Clamped here as well as in the route. The route's clamp keeps a hostile
  -- query string cheap; this one is what makes the ceiling a property of the
  -- database rather than of one caller's UI.
  v_page := LEAST(GREATEST(COALESCE(p_page, 1), 1), 100000);
  v_page_size := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);

  -- A term longer than any name or specialty is a mistake, not a search. The
  -- route refuses it; refusing it again here means an unbounded term cannot be
  -- pushed through any other caller.
  IF v_term IS NOT NULL AND char_length(v_term) > 64 THEN
    RAISE EXCEPTION 'search term is too long' USING ERRCODE = '22023';
  END IF;

  IF v_term IS NOT NULL THEN
    v_pattern := '%'
      || replace(
           replace(
             replace(v_term, v_escape, v_escape || v_escape),
             '%', v_escape || '%'
           ),
           '_', v_escape || '_'
         )
      || '%';
  END IF;

  RETURN QUERY
  SELECT
    candidate.id,
    candidate.user_id,
    candidate.tenant_id,
    candidate.role,
    candidate.full_name,
    candidate.specialty,
    candidate.status,
    candidate.created_at,
    candidate.last_login_at,
    candidate.deactivated_at,
    count(*) OVER () AS total_count
  FROM public.profiles AS candidate
  WHERE candidate.tenant_id = v_tenant
    -- The RLS read this replaces filtered inactive rows; a definer that reaches
    -- the table directly has to apply that predicate itself.
    AND public.profile_row_is_active(to_jsonb(candidate))
    AND (v_role_filter IS NULL OR candidate.role = v_role_filter)
    AND (v_status_filter IS NULL OR candidate.status = v_status_filter)
    AND (
      v_pattern IS NULL
      OR candidate.full_name ILIKE v_pattern ESCAPE v_escape
      OR candidate.specialty ILIKE v_pattern ESCAPE v_escape
    )
  ORDER BY candidate.created_at DESC, candidate.id
  OFFSET (v_page - 1) * v_page_size
  LIMIT v_page_size;
END;
$$;

REVOKE ALL ON FUNCTION public.search_users(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_users(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.search_users(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) IS
  'Tenant-scoped administrator user search. The term is a bound parameter matched as a literal substring against full_name OR specialty, so apostrophes and periods are searchable and LIKE wildcards are escaped. The tenant argument is checked against the authoritative principal; the row filter always uses the principal''s tenant. Page and limit are clamped, and role/status outside the known set are refused rather than ignored.';
