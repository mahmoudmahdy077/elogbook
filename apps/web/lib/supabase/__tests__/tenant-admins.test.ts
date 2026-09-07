import { describe, it, expect, vi } from 'vitest';
import { assertNotLastTenantAdmin } from '../tenant-admins';

// T18: a tenant must never lose its last institution_admin through role
// changes or deletion. Fails closed (409 conflict), not silent.
describe('assertNotLastTenantAdmin (T18)', () => {
  function mockAdmin(rows: Record<string, unknown>[]) {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: rows, error: null })),
            neq: vi.fn(async () => ({ data: rows, error: null })),
          })),
        })),
      })),
    };
  }

  it('allows demoting when another institution_admin remains', async () => {
    const admin = mockAdmin([{ id: 'other' }]);
    const res = await assertNotLastTenantAdmin(admin as never, {
      tenantId: 't1',
      profileId: 'p1',
      currentRole: 'institution_admin',
      newRole: 'resident',
    });
    expect(res.ok).toBe(true);
  });

  it('blocks demoting the last institution_admin with conflict', async () => {
    const admin = mockAdmin([]);
    const res = await assertNotLastTenantAdmin(admin as never, {
      tenantId: 't1',
      profileId: 'p1',
      currentRole: 'institution_admin',
      newRole: 'resident',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });

  it('blocks deleting the last institution_admin', async () => {
    const admin = mockAdmin([]);
    const res = await assertNotLastTenantAdmin(admin as never, {
      tenantId: 't1',
      profileId: 'p1',
      currentRole: 'institution_admin',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
  });

  it('allows no-op role retention and non-admin changes without counting', async () => {
    const admin = mockAdmin([]);
    const from = await import('../tenant-admins');
    expect(admin.from).toHaveBeenCalledTimes(0);
    const keep = await from.assertNotLastTenantAdmin(admin as never, {
      tenantId: 't1',
      profileId: 'p1',
      currentRole: 'institution_admin',
      newRole: 'institution_admin',
    });
    expect(keep.ok).toBe(true);
    const other = await from.assertNotLastTenantAdmin(admin as never, {
      tenantId: 't1',
      profileId: 'p1',
      currentRole: 'resident',
      newRole: 'supervisor',
    });
    expect(other.ok).toBe(true);
    expect(admin.from).toHaveBeenCalledTimes(0);
  });
});
