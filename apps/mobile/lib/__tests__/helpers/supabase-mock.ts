import { vi } from 'vitest';

type TableData = Map<string, Record<string, unknown>[]>;
const tables: TableData = new Map();
const filters: { table: string; filter: { op: string; col: string; val: unknown } }[] = [];

function getRows(table: string) {
  let rows = tables.get(table) ?? [];
  for (const f of filters) {
    if (f.table === table) {
      rows = rows.filter((r) => {
        const cell = r[f.filter.col] as unknown;
        const val = f.filter.val as unknown;
        if (f.filter.op === 'eq') return cell === val;
        if (f.filter.op === 'in' && Array.isArray(val)) return (val as unknown[]).includes(cell);
        return true;
      });
    }
  }
  return rows;
}

interface QueryResult<T = unknown> {
  data: T;
  error: null;
}

type Chain = {
  select(cols?: string): Chain;
  insert(rows: unknown): Chain & { error: null };
  update(vals: Record<string, unknown>): Chain;
  delete(): Chain;
  eq(col: string, val: unknown): Chain;
  in(col: string, vals: unknown[]): Chain;
  single(): QueryResult;
  maybeSingle(): QueryResult;
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: (value: QueryResult) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): Promise<TResult1 | TResult2>;
};

function builder(table: string): Chain {
  const exec = (): QueryResult => {
    const rows = getRows(table);
    const result: QueryResult = { data: rows, error: null };
    filters.length = 0;
    return result;
  };
  const chain: Chain = {
    select: () => chain,
    insert: (rows: unknown) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      for (const r of arr) tables.set(table, [...(tables.get(table) ?? []), r as Record<string, unknown>]);
      return Object.assign({}, chain, { error: null }) as Chain & { error: null };
    },
    update: (vals: Record<string, unknown>) => {
      const rows = tables.get(table) ?? [];
      tables.set(table, rows.map((r) => ({ ...r, ...vals })));
      return chain;
    },
    delete: () => chain,
    eq: (col, val) => { filters.push({ table, filter: { op: 'eq', col, val } }); return chain; },
    in: (col, vals) => { filters.push({ table, filter: { op: 'in', col, val: vals } }); return chain; },
    single: () => {
      const rows = getRows(table);
      filters.length = 0;
      return { data: rows[0] ?? null, error: null };
    },
    maybeSingle: () => {
      const rows = getRows(table);
      filters.length = 0;
      return { data: rows[0] ?? null, error: null };
    },
    then: (resolve) => Promise.resolve(exec()).then(resolve),
  };
  return chain;
}

export function createMockSupabaseClient() {
  return {
    from: (table: string): Chain => builder(table),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'jwt', user: { id: 'u-1' } } }, error: null }),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        queueMicrotask(() => cb('SIGNED_IN', { access_token: 'jwt', user: { id: 'u-1' } }));
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
  };
}

export function setTableData(table: string, rows: Record<string, unknown>[]) { tables.set(table, rows); }
export function resetMockData() { tables.clear(); filters.length = 0; }
