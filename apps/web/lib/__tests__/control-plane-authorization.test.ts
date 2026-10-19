import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Control-plane authority is a structural property, not a runtime detail.
// These source assertions run on every web test pass so a future edit cannot
// quietly reintroduce tenant-role authority, a NODE_ENV-only gate, or a raw
// error string in a control-plane response.

const controlPlaneRoutes = [
  '../../app/api/backup/route.ts',
  '../../app/api/backup/restore/route.ts',
  '../../app/api/uninstall/route.ts',
];

function sourceOf(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/**
 * Source with comments removed. Authorization assertions must be about code: a
 * doc comment that *explains* which labels are refused is exactly what these
 * routes should say, and matching it would make the check pass or fail for the
 * wrong reason.
 */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

describe('control-plane authorization', () => {
  it.each(controlPlaneRoutes)('%s derives authority from the platform-admin registry', (relativePath) => {
    const source = codeOf(relativePath);
    expect(source).toContain('requirePlatformAdmin');
    expect(source).toContain('createServerSupabase');
  });

  it.each(controlPlaneRoutes)('%s has no tenant role authority', (relativePath) => {
    const source = codeOf(relativePath);
    expect(source).not.toMatch(/ADMIN_ROLES/);
    expect(source).not.toMatch(/institution_admin/);
    expect(source).not.toMatch(/['"]director['"]/);
  });

  it.each(controlPlaneRoutes)('%s never trusts a client-reported assurance level', (relativePath) => {
    const source = codeOf(relativePath);
    expect(source).not.toMatch(/session\s*\)?\s*\.?\s*aal/);
    expect(source).not.toMatch(/getAuthenticatorAssuranceLevel/);
    expect(source).not.toMatch(/listFactors/);
  });

  it.each(controlPlaneRoutes)('%s keeps the production build containment check', (relativePath) => {
    expect(codeOf(relativePath)).toMatch(/NODE_ENV\s*===\s*'production'/);
  });

  it.each(controlPlaneRoutes)('%s never returns a raw caught error', (relativePath) => {
    const source = codeOf(relativePath);
    expect(source).not.toMatch(/errMsg/);
    expect(source).not.toMatch(/error:\s*(?:err|error)\.message/);
    expect(source).not.toMatch(/String\(error\)/);
  });

  it.each(controlPlaneRoutes)('%s marks every response no-store', (relativePath) => {
    const source = codeOf(relativePath);
    expect(source).toContain('controlPlaneJson');
    expect(source).not.toMatch(/NextResponse\.json\(/);
  });

  it('reads install state through overridable helpers, not hardcoded locations', () => {
    for (const relativePath of controlPlaneRoutes) {
      const source = codeOf(relativePath);
      expect(source).not.toMatch(/'\/app\/data\/supabase-config\.json'/);
      expect(source).not.toMatch(/'\/app\/data\/\.setup-complete'/);
      expect(source).toMatch(/readInstallConfig|isSetupComplete/);
    }
  });
});

describe('control-plane destructive primitives', () => {
  it('shells out only through the audited docker seam with an argument vector', () => {
    const uninstall = codeOf('../../app/api/uninstall/route.ts');
    expect(uninstall).toContain("from '@/lib/setup/host-exec'");
    expect(uninstall).not.toMatch(/from 'child_process'/);
    expect(uninstall).not.toMatch(/execSync/);
    expect(uninstall).not.toMatch(/rmSync\(\s*guarded/);
    expect(uninstall).not.toMatch(/rmSync\([^)]*request/);
  });

  it('validates every filesystem removal target before using it', () => {
    const installState = codeOf('../setup/install-state.ts');
    expect(installState).toContain('isSafeInstallPath');
    expect(installState).toMatch(/PROTECTED_ROOTS/);
    const uninstall = codeOf('../../app/api/uninstall/route.ts');
    expect(uninstall).toContain('isSafeInstallPath');
  });
});

describe('restore target containment', () => {
  const restoreRoute = codeOf('../../app/api/backup/restore/route.ts');
  const restoreTarget = codeOf('../setup/restore-target.ts');

  it('never accepts a caller-supplied database name', () => {
    expect(restoreRoute).not.toMatch(/targetDatabase:\s*z\./);
    expect(restoreRoute).toContain('resolveRestoreTarget');
    expect(restoreRoute).toMatch(/restoreTargetId/);
  });

  it('derives the target name from an operator-provisioned allowlist', () => {
    expect(restoreTarget).toContain('RESTORE_TARGET_ALLOWLIST');
    expect(restoreTarget).toContain('RESTORE_TARGET_PREFIX');
    expect(restoreTarget).toMatch(/not_provisioned/);
    expect(restoreTarget).toMatch(/reserved_database/);
  });
});
