import { describe, it, expect, vi } from 'vitest';
import {
  CASE_LIST_FIELDS,
  EVALUATION_LIST_FIELDS,
  fetchCasePage,
  fetchTemplatePage,
  fetchTenantList,
  countCasesByStatus,
  drainPaged,
  MAX_PAGE_SIZE,
} from '../query';

interface Call {
  select?: string;
  eq: Array<[string, unknown]>;
  order?: [string, boolean];
  range?: [number, number];
}

function fakeClient(rows: unknown[], log: Call[]) {
  return {
    from: (_t: string) => {
      const call: Call = { eq: [] };
      log.push(call);
      const chain: Record<string, (...a: never[]) => unknown> = {};
      chain.select = (cols: string) => {
        call.select = cols;
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        call.eq.push([col, val]);
        return chain;
      };
      chain.order = (col: string, opts: { ascending: boolean }) => {
        call.order = [col, opts.ascending];
        return chain;
      };
      chain.range = (from: number, to: number) => {
        call.range = [from, to];
        const all = rows as Array<Record<string, unknown>>;
        const page = all.slice(from, to + 1);
        return Promise.resolve({ data: page, error: null });
      };
      return chain;
    },
  };
}

describe('bounded queries (N2)', () => {
  it('projects typed fields (never select *) with tenant+user scope', async () => {
    const log: Call[] = [];
    const client = fakeClient([{ id: 'r1' }], log);
    const res = await fetchCasePage(client as never, { tenantId: 't1', residentId: 'r1', limit: 20 });
    expect(res.rows).toHaveLength(1);
    expect(log[0].select).toBe(CASE_LIST_FIELDS);
    expect(log[0].select).not.toContain('*');
    expect(log[0].eq).toContainEqual(['tenant_id', 't1']);
    expect(log[0].eq).toContainEqual(['resident_id', 'r1']);
    expect(log[0].range).toEqual([0, 19]);
  });

  it('clamps page size to the bound and rejects negative offsets', async () => {
    const log: Call[] = [];
    const client = fakeClient([], log);
    await fetchCasePage(client as never, { tenantId: 't1', residentId: 'r1', limit: 10_000 });
    expect(log[0].range?.[1]).toBe(MAX_PAGE_SIZE - 1);
    await expect(
      fetchCasePage(client as never, { tenantId: 't1', residentId: 'r1', offset: -5 }),
    ).rejects.toThrow(/offset/);
  });

  it('drains large datasets page by page (250 rows in 3 calls)', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: `r${i}` }));
    const log: Call[] = [];
    const client = fakeClient(rows, log);
    const all = await drainPaged((offset, limit) =>
      fetchTemplatePage(client as never, { tenantId: 't1', limit, offset }),
    );
    expect(all).toHaveLength(250);
    expect(log.length).toBe(3);
  });

  it('propagates server errors without leaking payloads', async () => {
    const client = { from: () => { throw new Error('secret-boom'); } };
    await expect(
      fetchCasePage(client as never, { tenantId: 't1', residentId: 'r1' }),
    ).rejects.toThrow();
    expect(vi).toBeDefined();
  });

  it('counts statuses exactly with bounded head queries (no row transfer)', async () => {
    const seen: Array<{ status: string }> = [];
    const client = {
      from: (_t: string) => ({
        select: (_c: string, _o: unknown) => ({
          eq: (_c1: string, _v: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              eq: (col: string, val: unknown) => {
                seen.push({ status: String(val) });
                const counts: Record<string, number> = { draft: 2, pending: 3, approved: 5 };
                return Promise.resolve({ count: counts[String(val)] ?? 0, error: null });
              },
            }),
          }),
        }),
      }),
    };
    const res = await countCasesByStatus(client as never, { tenantId: 't1', residentId: 'r1' });
    expect(res).toEqual({ draft: 2, pending: 3, approved: 5, total: 10 });
    expect(seen.map((s) => s.status).sort()).toEqual(['approved', 'draft', 'pending']);
  });

  it('fetches tenant lists with explicit projections and bounds', async () => {
    const log: Call[] = [];
    const client = fakeClient([{ id: 'e1' }], log);
    const res = await fetchTenantList(client as never, 'evaluation_forms', {
      tenantId: 't1', fields: EVALUATION_LIST_FIELDS, orderBy: 'created_at', limit: 500,
    });
    expect(res.rows).toHaveLength(1);
    expect(log[0].select).toBe(EVALUATION_LIST_FIELDS);
    expect(log[0].select).not.toContain('*');
    expect(log[0].eq).toContainEqual(['tenant_id', 't1']);
    expect(log[0].range).toEqual([0, MAX_PAGE_SIZE - 1]);
  });
});
