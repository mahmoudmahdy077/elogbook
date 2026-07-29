import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: 't-1' }, error: null })),
        })),
      })),
    })),
  })),
}));

const { GET } = await import('../route');

describe('GET /api/health', () => {
  it('returns 200 with status healthy', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(typeof body.timestamp).toBe('string');
  });

  it('returns valid JSON with timestamp', async () => {
    const res = await GET();
    const body = await res.json();

    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(body.timestamp).toBeDefined();
  });
});
