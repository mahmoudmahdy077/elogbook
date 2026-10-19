import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const routeSource = readFileSync(
  resolve(repoRoot, 'apps/web/app/api/[tenant]/admin/sso/route.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  resolve(repoRoot, 'supabase/migrations/20260925000001_sso_secret_encryption.sql'),
  'utf8',
);

describe('SSO secret containment', () => {
  it('uses the approved encryption RPC and safe projection', () => {
    expect(routeSource).toContain("rpc('store_tenant_sso_config'");
    expect(routeSource).toContain('projectSsoConfig');
    expect(routeSource).toContain('tenant_sso_configs_safe');
    expect(routeSource).not.toContain('client_secret_encrypted: client_secret');
    expect(routeSource).not.toMatch(/\bidp_certificate\s*:\s*idp_certificate/);
    expect(routeSource).not.toContain('return NextResponse.json({ config: guarded.data })');
  });

  it('defines encrypted columns, a safe view, and fail-closed key handling', () => {
    expect(migrationSource).toContain('client_secret_enc BYTEA');
    expect(migrationSource).toContain('idp_certificate_enc BYTEA');
    expect(migrationSource).toContain('tenant_sso_configs_safe');
    expect(migrationSource).toContain('encryption_unavailable');
    expect(migrationSource).toContain('REVOKE ALL ON TABLE public.tenant_sso_configs');
    expect(migrationSource).not.toContain('client_secret_encrypted = p_client_secret');
  });
});
