import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const webRoot = resolve(repoRoot, 'apps', 'web');

const assignRoleRoute = readFileSync(
  resolve(webRoot, 'app/api/[tenant]/admin/assign-role/route.ts'),
  'utf8',
);
const userRoute = readFileSync(
  resolve(webRoot, 'app/api/[tenant]/admin/users/[id]/route.ts'),
  'utf8',
);
const userActionRoute = readFileSync(
  resolve(webRoot, 'app/api/[tenant]/admin/users/[id]/action/route.ts'),
  'utf8',
);
const profileAdminMigration = readFileSync(
  resolve(repoRoot, 'supabase/migrations/20260925000005_profile_admin_rpcs.sql'),
  'utf8',
);

/** The only two surfaces besides assign-role that may change a profile. */
const profileMutationRoutes = [userRoute, userActionRoute];

function clientSourceFiles(): string[] {
  const roots = ['components', 'app', 'lib'];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules' || entry === '.next') continue;
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
        files.push(full);
      }
    }
  };
  for (const root of roots) walk(join(webRoot, root));
  return files;
}

const clientSources = clientSourceFiles().map((path) => ({
  path: path.slice(webRoot.length + 1).replace(/\\/g, '/'),
  source: readFileSync(path, 'utf8'),
}));

describe('assign-role contract matches the RPC', () => {
  it('names the request field for the profile surrogate key', () => {
    expect(assignRoleRoute).toMatch(/profile_id/);
    // The old schema field was `user_id` (auth.users.id), which the RPC never
    // accepted. It must not come back as an accepted field name.
    expect(assignRoleRoute).not.toMatch(/user_id\s*:\s*z\./);
    expect(assignRoleRoute).not.toMatch(/p_profile_id\s*:\s*user_id/);
  });

  it('passes the value through as p_profile_id', () => {
    expect(assignRoleRoute).toMatch(/rpc\(\s*'admin_assign_role'[\s\S]*?p_profile_id:\s*profileId/);
  });

  it('keeps the admin-role escalation gate and the last-admin mapping', () => {
    expect(assignRoleRoute).toMatch(/last_administrator/);
    expect(assignRoleRoute).toMatch(/status:\s*409/);
    expect(assignRoleRoute).toMatch(/role === 'admin' && profile\.role !== 'admin'/);
  });

  it('never falls back to a direct profiles write or auth metadata write', () => {
    expect(assignRoleRoute).not.toMatch(/\.from\(\s*['"]profiles['"]\s*\)/);
    expect(assignRoleRoute).not.toMatch(/raw_app_meta_data|app_metadata|updateUserById/);
  });
});

describe('the profile admin RPCs own role assignment', () => {
  it('resolves the target by profile id inside the tenant', () => {
    expect(profileAdminMigration).toMatch(
      /admin_assign_role\(\s*p_profile_id\s+UUID[\s\S]*?admin_update_profile\(/i,
    );
    expect(profileAdminMigration).toMatch(
      /SELECT\s+tenant_id\s+INTO\s+v_target_tenant_id\s+FROM\s+public\.profiles\s+WHERE\s+id\s*=\s*p_profile_id/i,
    );
  });

  it('requires a live AAL2 administrator', () => {
    expect(profileAdminMigration).toMatch(
      /v_principal\.aal IS DISTINCT FROM 'aal2'[\s\S]*?v_principal\.role NOT IN \('institution_admin', 'admin'\)/i,
    );
  });

  it('locks the tenant row and refuses the last administrator removal', () => {
    expect(profileAdminMigration).toMatch(
      /'the last active tenant administrator cannot be removed'/i,
    );
    expect(profileAdminMigration).toMatch(/FOR UPDATE/);
  });

  it('synchronizes auth app metadata only from inside the RPC', () => {
    expect(profileAdminMigration).toMatch(
      /IF v_has_role THEN[\s\S]*?UPDATE auth\.users[\s\S]*?raw_app_meta_data/i,
    );
  });
});

describe('no client writes a role outside the authenticated RPC', () => {
  it('never updates raw_app_meta_data from application code', () => {
    const offenders = clientSources.filter(({ source }) => /raw_app_meta_data/.test(source));
    expect(offenders.map((entry) => entry.path)).toEqual([]);
  });

  it('never writes auth metadata from application code', () => {
    // Session revocation legitimately calls updateUserById with a ban; what
    // must never appear is a metadata write, which is how a role is smuggled
    // around the AAL2 RPCs.
    const offenders = clientSources.filter(({ source }) =>
      /updateUserById[\s\S]{0,400}?(app_metadata|user_metadata|raw_app_meta_data)/.test(source),
    );
    expect(offenders.map((entry) => entry.path)).toEqual([]);
  });

  it('never issues a direct profiles update that carries an authorization column', () => {
    // Self-service edits of full_name / specialty / onboarding_completed are
    // allowed; role, status, pending_role, tenant_id and user_id are not.
    const offenders = clientSources.filter(({ source }) =>
      /from\(\s*['"]profiles['"]\s*\)[\s\S]{0,200}?\.update\(\s*\{[^}]*?\b(role|status|pending_role|tenant_id|user_id)\b/.test(source),
    );
    expect(offenders.map((entry) => entry.path)).toEqual([]);
  });

  it('routes every profile role change through the two admin RPCs', () => {
    const rpcCallers = clientSources.filter(({ source }) =>
      /rpc\(\s*'admin_(assign_role|update_profile|set_profile_status)'/.test(source),
    );
    expect(rpcCallers.map((entry) => entry.path).sort()).toEqual([
      'app/api/[tenant]/admin/assign-role/route.ts',
      'app/api/[tenant]/admin/users/[id]/action/route.ts',
      'app/api/[tenant]/admin/users/[id]/route.ts',
    ]);
  });

  it('keeps the admin table UI on the AAL2 profile endpoints', () => {
    const userTable = readFileSync(resolve(webRoot, 'components/UserTable.tsx'), 'utf8');
    expect(userTable).toMatch(/`\/api\/\$\{tenantSlug\}\/admin\/users\/\$\{user\.id\}`/);
    expect(userTable).not.toMatch(/assign-role/);
  });

  it('resolves the profile mutation routes against the profile surrogate key', () => {
    for (const source of profileMutationRoutes) {
      expect(source).toMatch(/\.eq\('id',\s*id\)\s*\n?\s*\.eq\('tenant_id',\s*profile\.tenant_id\)/);
    }
  });
});
