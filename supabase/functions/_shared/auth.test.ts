import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  authorizePrincipal,
  parseAuthoritativePrincipal,
  requirePrincipal,
  resolveAuthoritativePrincipal,
  type AuthResult,
  type AuthoritativePrincipal,
  type PrincipalLookupClient,
} from './auth.ts';

function principal(overrides: Partial<AuthoritativePrincipal> = {}): AuthoritativePrincipal {
  return {
    userId: 'user-1',
    profileId: 'profile-1',
    tenantId: 'tenant-1',
    role: 'director',
    profileStatus: 'active',
    tenantStatus: 'active',
    aal: 'aal1',
    ...overrides,
  };
}

function authResult(value: AuthoritativePrincipal): AuthResult {
  return {
    supabase: {} as AuthResult['supabase'],
    user: { id: value.userId } as AuthResult['user'],
    tenantId: value.tenantId,
    role: value.role,
    aal: value.aal,
    principal: value,
  };
}

Deno.test('authoritative principal parsing ignores client metadata claims', () => {
  const parsed = parseAuthoritativePrincipal({
    user_id: 'user-1',
    profile_id: 'profile-1',
    tenant_id: 'tenant-1',
    role: 'director',
    profile_status: 'active',
    tenant_status: 'active',
    aal: 'aal2',
    app_metadata: { tenant_id: 'tenant-evil', user_role: 'admin' },
  }, 'user-1');

  assert(parsed);
  assertEquals(parsed.tenantId, 'tenant-1');
  assertEquals(parsed.role, 'director');
  assertEquals(parsed.aal, 'aal2');
});

Deno.test('authoritative principal resolution uses the server AAL RPC', async () => {
  const calls: string[] = [];
  const client: PrincipalLookupClient = {
    rpc: (name) => {
      calls.push(name);
      return Promise.resolve({
        data: [{
          user_id: 'user-1',
          profile_id: 'profile-1',
          tenant_id: 'tenant-1',
          role: 'director',
          profile_status: 'active',
          tenant_status: 'active',
          aal: 'aal2',
        }],
        error: null,
      });
    },
  };

  const result = await resolveAuthoritativePrincipal(client, 'user-1');

  assertEquals(result?.aal, 'aal2');
  assertEquals(calls, ['get_authoritative_principal_with_aal']);
});

Deno.test('AAL1 privileged principals receive a generic 403', async () => {
  const response = await requirePrincipal(
    new Request('https://example.test/export'),
    { roles: ['director'], aal: 'aal2' },
    async () => authResult(principal({ role: 'director', aal: 'aal1' })),
  );

  assert(response instanceof Response);
  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: 'Forbidden' });
});

Deno.test('AAL2 privileged principals are allowed', async () => {
  const value = principal({ role: 'institution_admin', aal: 'aal2' });
  const result = await requirePrincipal(
    new Request('https://example.test/export'),
    { roles: ['director', 'institution_admin', 'admin'], aal: 'aal2' },
    async () => authResult(value),
  );

  assert(!(result instanceof Response));
  assertEquals(result.principal.role, 'institution_admin');
});

Deno.test('suspended profile and tenant principals are denied', () => {
  assertEquals(
    authorizePrincipal(principal({ profileStatus: 'suspended' }), { aal: 'aal2' }).ok,
    false,
  );
  assertEquals(
    authorizePrincipal(principal({ tenantStatus: 'suspended' }), { aal: 'aal2' }).ok,
    false,
  );
});

Deno.test('resident AAL1 self-service remains allowed', () => {
  const result = authorizePrincipal(
    principal({ role: 'resident', aal: 'aal1' }),
    { roles: ['resident'], aal: 'aal1' },
  );

  assertEquals(result.ok, true);
});

Deno.test('unknown roles fail closed', () => {
  const result = authorizePrincipal(principal({ role: 'service_account', aal: 'aal2' }), { aal: 'aal2' });
  assertEquals(result.ok, false);
});

Deno.test('tenant mismatch is denied even when role is privileged', () => {
  const result = authorizePrincipal(
    principal({ role: 'director', aal: 'aal2' }),
    { tenantId: 'tenant-2', aal: 'aal2' },
  );

  assertEquals(result.ok, false);
});
