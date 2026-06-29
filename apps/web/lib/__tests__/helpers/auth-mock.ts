import { vi } from 'vitest';

export type MockRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';

export function mockAuthContext(role: MockRole = 'resident', tenantId = 't-1') {
  return {
    supabase: {} as never,
    auth: {
      user: { id: 'u-1', app_metadata: { tenant_id: tenantId, user_role: role } },
      profile: {
        id: `p-${role}`,
        tenant_id: tenantId,
        user_id: 'u-1',
        role,
        full_name: `Mock ${role}`,
        specialty: 'general',
      },
      isReadOnly: false,
      daysUntilSuspension: 30,
    },
    req: { headers: new Headers({ origin: 'http://localhost:3000' }) } as never,
  };
}

export const mockRateLimiter = { allow: vi.fn().mockReturnValue(true) };
