import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Setup-created admin authority contract.
 *
 * Setup creates a TENANT administrator: a profile with role `admin`, pending
 * MFA promotion, in a tenant it just created. It does not, and must not, create
 * a platform operator.
 *
 * The distinction is load-bearing. `requirePlatformAdmin` derives control-plane
 * authority (backup, restore, uninstall) solely from the `platform_admins`
 * registry, and that registry is deliberately never auto-populated -- no
 * trigger, no backfill, no role mapping. So the account setup creates cannot
 * reach the control plane, by design.
 *
 * The risk being closed here is not that setup grants too much; it is that setup
 * grants too little and says nothing. An operator who finishes setup, signs in
 * as the new admin, and opens the backup page gets a bare 403 with no
 * explanation, and the reasonable conclusion is a broken install. So the route
 * states the contract in its response and the setup UI surfaces it, and a static
 * gate keeps a future edit from quietly turning the tenant admin into a
 * platform operator.
 */

const repoRoot = resolve(process.cwd(), '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

/** Comments removed: a rationale paragraph must not be read as behaviour. */
function codeOf(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

const createAdminRoute = 'apps/web/app/api/setup/create-admin/route.ts';

describe('setup admin authority', () => {
  it('does not create a platform operator', () => {
    const code = codeOf(createAdminRoute);
    // The registry is owner-attested only. Writing to it from a setup endpoint
    // would make a bootstrap HTTP request into a platform-authority grant.
    expect(code).not.toMatch(/platform_admins/);
    expect(code).not.toMatch(/platform_tenant_access/);
  });

  it('creates a tenant admin, not a platform one', () => {
    const code = codeOf(createAdminRoute);
    expect(code).toContain("pending_role");
    expect(code).toMatch(/'admin'/);
  });

  it('states the authority contract in its response rather than leaving a bare 403', () => {
    const code = codeOf(createAdminRoute);
    // The response has to say what the account is and what it is not, so the
    // operator learns the contract from the thing that created the account.
    expect(code).toMatch(/platformOperator:\s*false/);
    expect(code).toMatch(/grant-platform-admin\.sql/);
  });

  it('surfaces the provisioning requirement in the setup UI', () => {
    const ui = read('apps/web/app/setup/page.tsx');
    // The wording is owned by the route (one source of truth), so the page has
    // to render what the response said rather than restate it and drift.
    expect(ui).toContain('platformOperatorProvisioning');
    expect(ui).toMatch(/Platform operator access/);
  });

  it('keeps the owner-run grant script as the only provisioning path', () => {
    const script = read('scripts/grant-platform-admin.sql');
    // Out-of-band, owner-run, never invoked by the application.
    expect(script).toMatch(/INSERT INTO platform_admins/);
    const appSource = [
      'apps/web/app/api/setup/create-admin/route.ts',
      'apps/web/app/api/setup/complete/route.ts',
    ]
      .map(codeOf)
      .join('\n');
    expect(appSource).not.toMatch(/grant-platform-admin\.sql\s*['"`]?\s*;/);
  });

  it('the platform guard still reads the registry only', () => {
    const guard = codeOf('apps/web/lib/supabase/require-platform-admin.ts');
    expect(guard).toContain("from('platform_admins')");
    // A tenant role label must not be an alternative path to the control plane.
    expect(guard).not.toMatch(/role\s*===\s*['"]admin['"]/);
  });
});
