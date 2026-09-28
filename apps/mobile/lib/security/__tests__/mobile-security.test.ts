import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canPerform, type SensitiveAction } from '../../authorization';
import { fetchCapabilitySnapshot } from '../../capability';
import { guardRoute } from '../../route-guard';
import type { CapabilitySnapshot } from '../../capability';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..', '..', '..');
const repoRoot = join(mobileRoot, '..', '..');

function capability(overrides: Record<string, unknown> = {}): CapabilitySnapshot {
  return {
    userId: 'u1',
    tenantId: 't1',
    profileId: 'p1',
    role: 'resident',
    status: 'active',
    tenantStatus: 'active',
    policyVersion: 1,
    dataMode: 'deidentified',
    aal: 'aal2',
    expiresAt: Date.now() + 60_000,
    fetchedAt: Date.now(),
    ...overrides,
  } as unknown as CapabilitySnapshot;
}

function client(profile: Record<string, unknown>, tenant: Record<string, unknown>) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1' }, error: null }),
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === 'profiles') return { data: profile, error: null };
            if (table === 'tenants') return { data: tenant, error: null };
            return { data: { mode: 'deidentified', version: 1 }, error: null };
          },
        }),
      }),
    }),
  };
}

describe('mobile security hardening', () => {
  it('denies tenant-wide mutations and approvals at AAL1', () => {
    const cap = capability({ aal: 'aal1', role: 'supervisor', dataMode: 'identifiable' });
    const actions: SensitiveAction[] = [
      'evaluation:create',
      'duty:create',
      'attachment:upload',
      'ai:insights',
      'export:identifiable',
      'case:approve',
      'admin:tenant',
    ];
    for (const action of actions) {
      expect(canPerform(cap, action).ok, action).toBe(false);
    }
  });

  it('denies missing tenant or account status instead of defaulting to active', async () => {
    const missingTenant = capability({ tenantId: '' });
    expect(canPerform(missingTenant, 'case:create').ok).toBe(false);

    const missingAccountStatus = client(
      { id: 'p1', user_id: 'u1', tenant_id: 't1', role: 'resident' },
      { id: 't1', status: 'active' },
    );
    let denied = false;
    try {
      const snapshot = await fetchCapabilitySnapshot(missingAccountStatus as never);
      denied = snapshot.status !== 'active';
    } catch {
      denied = true;
    }
    expect(denied).toBe(true);

    const missingTenantStatus = capability({ tenantStatus: null });
    expect(canPerform(missingTenantStatus, 'case:create').ok).toBe(false);
  });

  it('does not treat local MFA timestamps as authorization evidence', () => {
    const source = readFileSync(join(mobileRoot, 'lib', 'capability.ts'), 'utf8');
    const removedField = ['mfa', 'VerifiedAt'].join('');
    expect(source).not.toContain(removedField);
  });

  it('keeps demo credentials and banners out of production login paths', () => {
    const mobileLogin = readFileSync(join(mobileRoot, 'app', 'login.tsx'), 'utf8');
    const webLogin = readFileSync(join(repoRoot, 'apps', 'web', 'app', 'login', 'page.tsx'), 'utf8');
    const loginAction = readFileSync(join(repoRoot, 'apps', 'web', 'app', 'login', 'actions.ts'), 'utf8');
    expect(mobileLogin).not.toMatch(/@demo\.com|password123!/i);
    expect(webLogin).toMatch(/NODE_ENV\s*!==\s*['"]production['"][\s\S]*NEXT_PUBLIC_SHOW_DEMO_BANNER/);
    expect(loginAction).not.toMatch(/\?\?\s*['"]demo['"]/);
  });

  it('does not expose the plaintext clinical database path in production', () => {
    const databaseSource = readFileSync(join(mobileRoot, 'lib', 'db', 'database.ts'), 'utf8');
    const dataAccessSource = readFileSync(join(mobileRoot, 'lib', 'data-access.ts'), 'utf8');
    expect(databaseSource).toMatch(/NODE_ENV\s*===\s*['"]production['"]/);
    expect(databaseSource).toMatch(/new SQLiteAdapter/);
    expect(dataAccessSource).not.toMatch(/sealedFv\s*\?\s*parsed\s*:\s*\(row\.fieldValues\s*\?\?\s*\{\}\)/);
  });

  it('requires referenced native network-security artifacts', () => {
    const sourcePath = join(mobileRoot, 'native', 'android', 'network_security_config.xml');
    const appJson = JSON.parse(readFileSync(join(mobileRoot, 'app.json'), 'utf8'));
    const plugins = appJson.expo?.plugins ?? [];
    expect(existsSync(sourcePath)).toBe(true);
    expect(plugins.some((plugin: unknown) =>
      (typeof plugin === 'string' && plugin.includes('withNetworkSecurityConfig'))
      || (Array.isArray(plugin) && plugin[0] === './plugins/withNetworkSecurityConfig'))).toBe(true);
    if (existsSync(sourcePath)) {
      const xml = readFileSync(sourcePath, 'utf8');
      expect(xml).toMatch(/cleartextTrafficPermitted="false"/);
      expect(xml).toMatch(/<pin-set\b/);
      expect(xml).toMatch(/supabase\.co/);
    }
  });

  it('keeps pin rotation and the production storage decision documented', () => {
    const docPath = join(repoRoot, 'docs', 'security', 'mobile-native-security.md');
    expect(existsSync(docPath)).toBe(true);
    if (existsSync(docPath)) {
      const doc = readFileSync(docPath, 'utf8');
      expect(doc).toMatch(/pin rotation/i);
      expect(doc).toMatch(/SQLCipher/);
      expect(doc).toMatch(/operator-provided/i);
      expect(doc).toMatch(/REPLACE_WITH_PRIMARY_SPKI_PIN/);
      expect(doc).toMatch(/REPLACE_WITH_BACKUP_SPKI_PIN/);
      expect(doc).toMatch(/ANDROID_PRIMARY_SPKI_PIN/);
      expect(doc).toMatch(/ANDROID_BACKUP_SPKI_PIN/);
      expect(doc).toMatch(/EAS environment/i);
      expect(doc).toMatch(/fail(?:s|ed)? closed/i);
    }
    const checker = readFileSync(join(repoRoot, 'scripts', 'verify-mobile-security.mjs'), 'utf8');
    expect(checker).toMatch(/RELEASE BLOCKER/i);
    expect(checker).toMatch(/build-time pin injection/i);
    expect(checker).toMatch(/networkConfigTemplatePath/);
    expect(checker).toMatch(/generatedNetworkConfigPath/);
    expect(checker).toMatch(/templatePins[\s\S]*REPLACE_WITH_PRIMARY_SPKI_PIN/);
    expect(checker).toMatch(/REPLACE_WITH_BACKUP_SPKI_PIN/);
  });

  it('keeps EAS production profiles free of demo configuration', () => {
    const eas = JSON.parse(readFileSync(join(mobileRoot, 'eas.json'), 'utf8'));
    for (const profile of ['production', 'preview']) {
      expect(eas.build[profile].env.NODE_ENV).toBe('production');
    }
    expect(readFileSync(join(mobileRoot, 'eas.json'), 'utf8')).not.toMatch(/DEMO_CREDENTIAL|SHOW_DEMO_BANNER/i);
  });

  it('scopes case-detail reads to the active tenant and resident profile', () => {
    const source = readFileSync(join(mobileRoot, 'app', '(tabs)', 'case-detail.tsx'), 'utf8');
    expect(source).toMatch(/\.eq\('tenant_id', profile\.tenant_id\)/);
    expect(source).toMatch(/profile\.role === 'resident'[\s\S]*\.eq\('resident_id', profile\.id\)/);
  });

  it('does not expose tenant-wide routes at AAL1', () => {
    const cap = capability({ aal: 'aal1', role: 'supervisor' });
    expect(guardRoute('analytics', cap).ok).toBe(false);
    expect(guardRoute('rotations', cap).ok).toBe(false);
    expect(guardRoute('milestones', cap).ok).toBe(false);
  });
});
