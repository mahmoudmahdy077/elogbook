import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const setupCompose = readFileSync(resolve(repoRoot, 'setup.docker-compose.yml'), 'utf8');
const productionCompose = readFileSync(resolve(repoRoot, 'docker-compose.yml'), 'utf8');
const dockerfile = readFileSync(resolve(repoRoot, 'apps/web/Dockerfile'), 'utf8');
const instrumentation = readFileSync(resolve(repoRoot, 'apps/web/instrumentation.ts'), 'utf8');
const envValidation = readFileSync(resolve(repoRoot, 'packages/env/src/index.ts'), 'utf8');
const guard = readFileSync(resolve(repoRoot, 'apps/web/lib/setup/guard.ts'), 'utf8');
const completeRoute = readFileSync(resolve(repoRoot, 'apps/web/app/api/setup/complete/route.ts'), 'utf8');
const deployRoute = readFileSync(resolve(repoRoot, 'apps/web/app/api/setup/deploy-supabase/route.ts'), 'utf8');
const migrateRoute = readFileSync(resolve(repoRoot, 'apps/web/app/api/setup/migrate/route.ts'), 'utf8');
const createAdminRoute = readFileSync(resolve(repoRoot, 'apps/web/app/api/setup/create-admin/route.ts'), 'utf8');
const domainRoute = readFileSync(resolve(repoRoot, 'apps/web/app/api/setup/configure-domain/route.ts'), 'utf8');
const proxy = readFileSync(resolve(repoRoot, 'apps/web/proxy.ts'), 'utf8');

function stage(name: string, nextName: string): string {
  const start = dockerfile.indexOf(`FROM web-runner AS ${name}`);
  const end = dockerfile.indexOf(`FROM web-runner AS ${nextName}`, start);
  return dockerfile.slice(start, end === -1 ? undefined : end);
}

describe('setup control-plane containment', () => {
  it('uses an explicit non-production setup phase and build metadata', () => {
    expect(setupCompose).toContain('target: setup');
    expect(setupCompose).toContain('SETUP_MODE: "true"');
    expect(setupCompose).toContain('SETUP_PHASE: "setup"');
    expect(setupCompose).toContain('SETUP_BIND_ADDRESS: "127.0.0.1"');
    expect(setupCompose).toContain('SETUP_REMOTE_TLS_REQUIRED: "true"');
    expect(setupCompose).toMatch(/NODE_ENV:\s*development/);
    expect(setupCompose).not.toMatch(/NODE_ENV:\s*production/);
    expect(setupCompose).toContain('APP_RELEASE_COMMIT:');
    expect(dockerfile).toContain('ARG APP_RELEASE_COMMIT');
    expect(dockerfile).toContain('ENV APP_RELEASE_COMMIT=${APP_RELEASE_COMMIT}');
    expect(instrumentation).toContain('parseSetupEnv');
    expect(instrumentation).toContain('SETUP_MODE');
  });

  it('keeps setup tools and the host socket out of production web', () => {
    const setupStage = stage('setup', 'production');
    const productionStage = dockerfile.slice(dockerfile.indexOf('FROM web-runner AS production'));
    expect(setupCompose).toContain('/var/run/docker.sock:/var/run/docker.sock');
    expect(setupStage).toMatch(/apk add[^\n]*(git|docker-cli)/);
    expect(setupStage).toContain('postgresql-client');
    expect(productionStage).not.toMatch(/apk add[^\n]*(git|docker-cli|postgresql-client)/);
    expect(productionStage).not.toContain('/var/run/docker.sock');
    expect(productionCompose).not.toContain('/var/run/docker.sock');
    expect(productionCompose).toContain('SETUP_MODE: "false"');
    expect(proxy).toContain("process.env.NODE_ENV === 'production'");
  });

  it('binds setup to loopback or SSH and joins the Supabase network', () => {
    expect(setupCompose).toContain('127.0.0.1:3000:3000');
    expect(setupCompose).not.toMatch(/^\s*-\s*["']?3000:3000/m);
    expect(setupCompose).toMatch(/networks:\s*\n\s+- supabase_default/);
    expect(setupCompose).toMatch(/supabase_default:\s*\n\s+external:\s*true/);
    expect(guard).toContain("isLoopback");
    expect(guard).toContain('SETUP_REMOTE_TLS_REQUIRED');
  });

  it('requires phase-specific environment validation and a release commit', () => {
    expect(envValidation).toContain('APP_RELEASE_COMMIT');
    expect(envValidation).toContain('SETUP_PHASE');
    expect(envValidation).toContain('SETUP_BIND_ADDRESS');
    expect(instrumentation.lastIndexOf('parseSetupEnv(')).toBeLessThan(instrumentation.lastIndexOf('parseWebFullEnv('));
    expect(guard).toContain("NODE_ENV !== 'production'");
  });

  it('verifies every setup receipt before writing the completion marker', () => {
    for (const receipt of ['setup-deploy.json', 'migrations-applied.json', 'setup-admin.json', 'setup-domain.json']) {
      expect(guard).toContain(receipt);
    }
    expect(completeRoute.lastIndexOf('verifySetupReceipts')).toBeLessThan(completeRoute.lastIndexOf('writeSetupMarkerAtomically'));
    expect(completeRoute).toContain('APP_RELEASE_COMMIT');
    expect(completeRoute).not.toMatch(/child_process|execSync|git rev-parse/);
  });

  it('cleans step receipts when a setup step fails', () => {
    for (const route of [deployRoute, migrateRoute, createAdminRoute, domainRoute]) {
      expect(route).toMatch(/remove|unlink|rollback|cleanup/i);
    }
    expect(deployRoute).toContain("'down'");
    expect(completeRoute).toContain('removeSetupMarker');
  });
});
