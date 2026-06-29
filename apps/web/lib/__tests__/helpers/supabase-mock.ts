import { vi } from 'vitest';

type TableData = Map<string, Record<string, unknown>[]>;
type Filter = { op: string; col: string; val: unknown };

const tables: TableData = new Map();
const filters: { table: string; filter: Filter }[] = [];

function getRows(table: string): Record<string, unknown>[] {
  let rows = tables.get(table) ?? [];
  for (const f of filters) {
    if (f.table === table) {
      rows = rows.filter((r) => {
        if (f.filter.op === 'eq') return r[f.filter.col] === f.filter.val;
        if (f.filter.op === 'in' && Array.isArray(f.filter.val)) {
          return (f.filter.val as unknown[]).includes(r[f.filter.col]);
        }
        if (f.filter.op === 'gte') return r[f.filter.col] >= f.filter.val;
        if (f.filter.op === 'lte') return r[f.filter.col] <= f.filter.val;
        if (f.filter.op === 'is') {
          if (f.filter.val === null) return r[f.filter.col] === null;
          return r[f.filter.col] !== null;
        }
        return true;
      });
    }
  }
  return rows;
}

function builder(table: string, state: { op?: string; col?: string; val?: unknown; limit?: number; single?: boolean; maybeSingle?: boolean }) {
  const exec = (): { data: unknown; error: null } => {
    let rows = getRows(table);
    if (state.single) return { data: rows[0] ?? null, error: null };
    if (state.maybeSingle) return { data: rows[0] ?? null, error: null };
    if (state.limit !== undefined) rows = rows.slice(0, state.limit);
    const result = { data: rows, error: null };
    filters.length = 0;
    return result;
  };
  const chain = {
    select: (_cols?: string) => chain,
    insert: (rows: unknown) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      for (const r of arr) tables.set(table, [...(tables.get(table) ?? []), r as Record<string, unknown>]);
      return { ...chain, then: undefined, error: null };
    },
    update: (vals: Record<string, unknown>) => {
      const rows = tables.get(table) ?? [];
      tables.set(table, rows.map((r) => ({ ...r, ...vals })));
      return { eq: (...a: unknown[]) => { filters.push({ table, filter: { op: 'eq', col: a[0] as string, val: a[1] } }); return chain; } };
    },
    upsert: (rows: unknown) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      for (const r of arr) tables.set(table, [...(tables.get(table) ?? []), r as Record<string, unknown>]);
      return { error: null };
    },
    delete: () => ({ eq: (...a: unknown[]) => { filters.push({ table, filter: { op: 'eq', col: a[0] as string, val: a[1] } }); exec(); return { error: null }; } }),
    eq: (...a: unknown[]) => { filters.push({ table, filter: { op: 'eq', col: a[0] as string, val: a[1] } }); return chain; },
    in: (...a: unknown[]) => { filters.push({ table, filter: { op: 'in', col: a[0] as string, val: a[1] } }); return chain; },
    gte: (...a: unknown[]) => { filters.push({ table, filter: { op: 'gte', col: a[0] as string, val: a[1] } }); return chain; },
    lte: (...a: unknown[]) => { filters.push({ table, filter: { op: 'lte', col: a[0] as string, val: a[1] } }); return chain; },
    is: (...a: unknown[]) => { filters.push({ table, filter: { op: 'is', col: a[0] as string, val: a[1] } }); return chain; },
    order: () => chain,
    range: () => chain,
    limit: (n: number) => { state.limit = n; return chain; },
    single: () => { state.single = true; return chain; },
    maybeSingle: () => { state.maybeSingle = true; return chain; },
    then: (resolve: (v: unknown) => void) => resolve(exec()),
  };
  return chain;
}

export function createMockSupabaseClient() {
  return {
    from: (table: string) => builder(table, {}),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1', app_metadata: { tenant_id: 't-1', user_role: 'resident' } } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt', user: { id: 'u-1' } } }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

export function setTableData(table: string, rows: Record<string, unknown>[]) {
  tables.set(table, rows);
}

export function resetMockData() {
  tables.clear();
  filters.length = 0;
}
