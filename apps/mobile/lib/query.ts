/**
 * N2 — bounded, typed, scoped queries.
 *
 * Screens must not issue `select('*')` or unbounded fetches: every list
 * declares its projection (typed field set), tenant+user scope, ordering,
 * and page bounds here. Large datasets drain via drainPaged (100-row
 * pages); traces, not caching, decide further optimization.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

/** Case list projection: identifiers needed for display + status, nothing more. */
export const CASE_LIST_FIELDS =
  'id,patient_mrn,patient_hash,patient_dob,case_date,status,is_deidentified,template_id,case_templates(name,specialty)';

/** Template list projection. */
export const TEMPLATE_LIST_FIELDS = 'id,name,specialty,fields,required_fields';

/** Evaluation list projection (matches EvaluationData; no payload extras). */
export const EVALUATION_LIST_FIELDS =
  'id,form_type,resident_id,evaluator_id,encounter_date,setting,overall_score,status,created_at';

/** Milestone list projection (matches MilestoneData). */
export const MILESTONE_LIST_FIELDS =
  'id,competency_area,sub_competency,level,assessment_date,assessor_id,comments';

/** Single-row case hydrate projection for the edit flow. */
export const CASE_HYDRATE_FIELDS =
  'id,template_id,is_deidentified,patient_mrn,patient_dob,patient_age_years,case_date,field_values';

export interface PageQuery {
  tenantId: string;
  residentId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface PageResult<T> {
  rows: T[];
  page: { limit: number; offset: number };
}

type QueryChain = {
  select: (cols: string) => QueryChain;
  eq: (col: string, val: string) => QueryChain;
  order: (col: string, opts: { ascending: boolean }) => QueryChain;
  range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
};

type ScopedClient = {
  from: (table: string) => QueryChain;
};

function clampPage(q: PageQuery): { limit: number; offset: number } {
  const offset = q.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) throw new Error('[query] offset must be a non-negative integer');
  const requested = q.limit ?? DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(1, Math.floor(requested)), MAX_PAGE_SIZE);
  return { limit, offset };
}

export async function fetchCasePage<T = Record<string, unknown>>(
  client: ScopedClient,
  q: PageQuery,
): Promise<PageResult<T>> {
  if (!q.tenantId) throw new Error('[query] tenant scope required');
  if (!q.residentId) throw new Error('[query] resident scope required');
  const { limit, offset } = clampPage(q);
  let chain = client
    .from('case_entries')
    .select(CASE_LIST_FIELDS)
    .eq('tenant_id', q.tenantId)
    .eq('resident_id', q.residentId);
  if (q.status) chain = chain.eq('status', q.status);
  const { data, error } = await chain.order('case_date', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(`[query] case page failed: ${error.message}`);
  return { rows: ((data ?? []) as T[]), page: { limit, offset } };
}

export async function fetchTemplatePage<T = Record<string, unknown>>(
  client: ScopedClient,
  q: { tenantId: string; limit?: number; offset?: number },
): Promise<PageResult<T>> {
  if (!q.tenantId) throw new Error('[query] tenant scope required');
  const { limit, offset } = clampPage(q);
  const { data, error } = await client
    .from('case_templates')
    .select(TEMPLATE_LIST_FIELDS)
    .eq('tenant_id', q.tenantId)
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`[query] template page failed: ${error.message}`);
  return { rows: ((data ?? []) as T[]), page: { limit, offset } };
}

/** Drain a full list through bounded pages (stops on a short page). */
export async function drainPaged<T>(
  fetchPage: (offset: number, limit: number) => Promise<PageResult<T>>,
  limit = MAX_PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, limit);
    out.push(...page.rows);
    if (page.rows.length < page.page.limit) break;
    offset += page.page.limit;
  }
  return out;
}

export interface StatusCounts {
  draft: number;
  pending: number;
  approved: number;
  total: number;
}

type HeadCountQuery = Promise<{ count: number | null; error: { message: string } | null }> & {
  eq: (col: string, val: string) => HeadCountQuery;
};

type CountClient = {
  from: (table: 'case_entries') => {
    select: (cols: 'id', opts: { count: 'exact'; head: true }) => HeadCountQuery;
  };
};

/**
 * Exact status counts via bounded head-count queries (no row transfer).
 * Replaces fetch-all-then-count aggregations on dashboard/analytics widgets.
 */
export async function countCasesByStatus(
  client: CountClient,
  scope: { tenantId: string; residentId: string },
): Promise<StatusCounts> {
  if (!scope.tenantId) throw new Error('[query] tenant scope required');
  if (!scope.residentId) throw new Error('[query] resident scope required');
  const out: StatusCounts = { draft: 0, pending: 0, approved: 0, total: 0 };
  for (const status of ['draft', 'pending', 'approved'] as const) {
    const { count, error } = await client
      .from('case_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', scope.tenantId)
      .eq('resident_id', scope.residentId)
      .eq('status', status);
    if (error) throw new Error(`[query] status count failed: ${error.message}`);
    out[status] = count ?? 0;
    out.total += out[status];
  }
  return out;
}

/**
 * Bounded list fetch for tables keyed by tenant (+ optional extra equality).
 * Used for evaluations/milestones lists (100-row pages, newest first).
 */
export async function fetchTenantList<T = Record<string, unknown>>(
  client: ScopedClient,
  table: string,
  q: { tenantId: string; fields: string; orderBy: string; extraEq?: Array<[string, string]>; limit?: number; offset?: number },
): Promise<PageResult<T>> {
  if (!q.tenantId) throw new Error('[query] tenant scope required');
  const { limit, offset } = clampPage(q);
  let chain = client.from(table).select(q.fields).eq('tenant_id', q.tenantId);
  for (const [col, val] of q.extraEq ?? []) chain = chain.eq(col, val);
  const { data, error } = await chain.order(q.orderBy, { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(`[query] ${table} page failed: ${error.message}`);
  return { rows: ((data ?? []) as T[]), page: { limit, offset } };
}
