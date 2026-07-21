import { describe, it, expect, vi, beforeEach } from 'vitest';
const endpoints = ['sso', 'scim', 'webhooks', 'ai-config', 'payment-gateway', 'assign-role', 'invite'];
describe('admin endpoint role gating', () => {
  it.each(endpoints)('%s returns 403 for resident', async (endpoint) => {
    vi.mock('@/lib/supabase/server', () => ({
      createServerSupabase: vi.fn(async () => ({
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'resident-1' } }, error: null })) },
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: 'p1', tenant_id: 't1', role: 'resident', tenants: { slug: 'test-tenant' } }, error: null })),
            })),
          })),
        })),
      })),
    }));
    const mod = await import(`../../${endpoint}/route`);
    const req = new Request(`http://localhost/api/test-tenant/admin/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const res = await mod.POST(req, { params: { tenant: 'test-tenant' } });
    expect(res.status).toBe(403);
  });
});
