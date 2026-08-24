import { describe, it, expect, vi } from 'vitest';

// RLS hides all rows from anon clients — an empty data array with no error is
// the healthy path. Transport/schema failures surface as `error`.
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(async () => ({ data: [], error: null })),
      })),
    })),
  })),
}));

const { GET } = await import('../route');

describe('GET /api/health', () => {
  it('returns 200 with status healthy when DB query succeeds (RLS-empty ok)', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.db).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.durationMs).toBe('number');
  });

  it('returns valid JSON with timestamp', async () => {
    const res = await GET();
    const body = await res.json();

    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(body.timestamp).toBeDefined();
  });

  it('returns 503 when the DB query errors', async () => {
    const { createServerSupabase } = await import('@/lib/supabase/server');
    (createServerSupabase as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'boom' } })),
        })),
      })),
    }));
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe('unhealthy');
  });
});
