import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { logger } from '@/lib/logger';

const ADMIN_ROLES = ['institution_admin', 'admin'];

/**
 * Roles a profile may hold. A filter outside this set is refused, not queried. */
export const USER_ROLES = [
  'resident',
  'supervisor',
  'director',
  'institution_admin',
  'admin',
] as const;

/**
 * Account states a profile may be in. The set is the one the database holds:
 * `profiles.status` is CHECK-constrained to these values and `search_users`
 * refuses anything else, so a value outside it can never match a row.
 */
export const USER_STATUSES = ['active', 'inactive', 'pending', 'suspended', 'deactivated'] as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Longest search term forwarded to the database, in characters. */
export const SEARCH_MAX_LENGTH = 64;

/**
 * Search term handling.
 *
 * A name or specialty search has to match EITHER column. The PostgREST builder
 * can say that -- `.or('full_name.ilike.%t%,specialty.ilike.%t%')` -- but the
 * value it takes is a filter grammar, not a string: `,` separates clauses, `.`
 * separates a column from its operator, and parentheses group. Inside that
 * grammar an apostrophe is a quote and a period is a separator, and the LIKE
 * wildcards `%` and `_` have no escape convention at all.
 *
 * The previous handling resolved that by refusing any term containing a quote,
 * a period or a wildcard. That is safe and wrong: it made `O'Brien` and
 * `Dr. Smith` unfindable, and unfindable is indistinguishable from nonexistent
 * to the person doing the looking. Security was bought with a correctness bug.
 *
 * So the search moves into `public.search_users`, where the term is a bound
 * parameter and the OR is an ordinary SQL disjunction. The route's job is
 * reduced to what only it can do: keep the term whole, refuse nothing that a
 * person could plausibly type, and hand the database a bounded page.
 *
 * Reads with no search term stay on the builder. That path is already safe --
 * the tenant predicate is a bound `.eq()` and the role/status filters are
 * allowlisted values -- so there is nothing to move and no reason to.
 */
function parseSearch(raw: string | null): string | null {
  if (raw === null) return null;
  const term = raw.trim();
  if (term.length === 0) return null;
  // An over-long term cannot match a name or a specialty, so it is a mistake
  // rather than a search. The database bounds it again; this keeps the request
  // from carrying megabytes of junk to the database to be refused there.
  if (term.length > SEARCH_MAX_LENGTH) return null;
  return term;
}

function parsePageSize(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function parsePage(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  // Bounded so `page` cannot be used to walk the offset arbitrarily far.
  return Math.min(parsed, 100_000);
}

/**
 * An allowlisted filter, or the refusal of one that is not.
 *
 * Dropping an unsupported filter answers a wider question than the caller asked:
 * `?status=deleted` silently returns the whole tenant, and an administrator
 * reads that as "nobody is in that state" rather than "that state is not a
 * thing". `search_users` already refuses the same values with 22023, so the
 * route refusing them first makes the two agree and costs no round trip.
 */
type EnumFilter<T extends string> = { ok: true; value: T | null } | { ok: false; error: string };

function parseEnum<T extends string>(raw: string | null, allowed: readonly T[], label: string): EnumFilter<T> {
  // An absent filter is not an unsupported one. Refusing it would make the list
  // unusable, and the two are indistinguishable to anyone reading a log line.
  if (raw === null || raw === '') return { ok: true, value: null };
  if ((allowed as readonly string[]).includes(raw)) return { ok: true, value: raw as T };
  return { ok: false, error: `unsupported ${label} filter` };
}

type SearchUserRow = {
  id: string;
  user_id: string;
  tenant_id: string;
  role: string;
  full_name: string;
  specialty: string | null;
  status: string | null;
  created_at: string | null;
  last_login_at: string | null;
  deactivated_at: string | null;
  total_count: number;
};

/**
 * Every column but the row count, so the count is not repeated on every row and
 * the client sees exactly the projection the unfiltered read returns.
 */
function toProjection(row: SearchUserRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    role: row.role,
    full_name: row.full_name,
    specialty: row.specialty,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    deactivated_at: row.deactivated_at,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantSlug = request.nextUrl.pathname.split('/')[1];
  const search = parseSearch(searchParams.get('search'));
  const roleFilter = parseEnum(searchParams.get('role'), USER_ROLES, 'role');
  const statusFilter = parseEnum(searchParams.get('status'), USER_STATUSES, 'status');
  const page = parsePage(searchParams.get('page'));
  const limit = parsePageSize(searchParams.get('limit'));

  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, ADMIN_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

  const { allowed, retryAfter } = await checkRateLimit(`admin-users:${tenantSlug}`, 120);
  if (!allowed) return rateLimitResponse(retryAfter);

  // Refused after the authorization gate, so an unauthenticated caller cannot
  // use the error to read the allowlist back out of the route.
  if (!roleFilter.ok) return NextResponse.json({ error: roleFilter.error }, { status: 400 });
  if (!statusFilter.ok) return NextResponse.json({ error: statusFilter.error }, { status: 400 });
  const role = roleFilter.value;
  const status = statusFilter.value;

  if (search !== null) {
    // The RPC resolves the tenant from the authoritative principal, so the
    // tenant argument is checked against the caller's own rather than trusted;
    // passing it keeps the call shaped like the rest of the tenant surface.
    const { data, error } = await supabase.rpc('search_users', {
      p_tenant_id: profile.tenant_id,
      p_search: search,
      p_role: role,
      p_status: status,
      p_page: page,
      p_limit: limit,
    });

    if (error) {
      // The database message can name hosts, roles and constraints; it is logged
      // under redaction and never returned.
      logger.error('Failed to search tenant users', error, { tenantSlug, page, limit });
      return NextResponse.json({ error: 'Failed to search users' }, { status: 500 });
    }

    const rows = (data ?? []) as SearchUserRow[];
    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;

    return NextResponse.json({
      users: rows.map(toProjection),
      total: Number.isFinite(total) ? total : 0,
      page,
      limit,
      pages: Math.ceil((Number.isFinite(total) ? total : 0) / limit),
    });
  }

  // The tenant predicate is applied first and is never caller-influenced, so
  // every later filter narrows the same tenant scope rather than widening it.
  let query = supabase
    .from('profiles')
    .select('id, user_id, tenant_id, role, full_name, specialty, status, created_at, last_login_at, deactivated_at', { count: 'exact' })
    .eq('tenant_id', profile.tenant_id);

  if (role) {
    query = query.eq('role', role);
  }
  if (status) {
    query = query.eq('status', status);
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data: users, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    // The database message can name hosts, roles and constraints; it is logged
    // under redaction and never returned.
    logger.error('Failed to list tenant users', error, { tenantSlug, page, limit });
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }

  return NextResponse.json({
    users: users ?? [],
    total: count ?? 0,
    page,
    limit,
    pages: Math.ceil((count ?? 0) / limit),
  });
}
