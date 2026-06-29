import { vi } from 'vitest';

type TableData = Map<string, Record<string, unknown>[]>;
const tables: TableData = new Map();
const filters: { table: string; filter: { op: string; col: string; val: unknown } }[] = [];

function getRows(table: string) {
  let rows = tables.get(table) ?? [];
  for (const f of filters) {
    if (f.table === table) {
      rows = rows.filter((r) => {
        if (f.filter.op === 'eq') return r[f.filter.col] === f.filter.val;
        if (f.filter.op === 'in' && Array.isArray(f.filter.val)) return (f.filter.val as unknown[]).includes(r[f.filter.col]);
        return true;
      });
    }
  }
  return rows;
}

function builder(table: string) {
  const exec = () => {
    const rows = getRows(table);
    const result = { data: rows, error: null };
    filters.length = 0;
    return result;
  };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.insert = (rows: unknown) => {
    const arr = Array.isArray(rows) ? rows : [rows];
    for (const r of arr) tables.set(table, [...(tables.get(table) ?? []), r as Record<string, unknown>]);
    return { ...chain, error: null };
  };
  chain.update = (vals: Record<string, unknown>) => {
    const rows = tables.get(table) ?? [];
    tables.set(table, rows.map((r) => ({ ...r, ...vals })));
    return chain;
  };
  chain.delete = () => chain;
  chain.eq = (...a: unknown[]) => { filters.push({ table, filter: { op: 'eq', col: a[0] as string, val: a[1] } }); return chain; };
  chain.in = (...a: unknown[]) => { filters.push({ table, filter: { op: 'in', col: a[0] as string, val: a[1] } }); return chain; };
  chain.single = () => { const rows = getRows(table); filters.length = 0; return { data: rows[0] ?? null, error: null }; };
  chain.maybeSingle = () => { const rows = getRows(table); filters.length = 0; return { data: rows[0] ?? null, error: null }; };
  chain.then = (resolve: (v: unknown) => void) => resolve(exec());
  return chain;
}

export function createMockSupabaseClient() {
  return {
    from: (table: string) => builder(table),
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
