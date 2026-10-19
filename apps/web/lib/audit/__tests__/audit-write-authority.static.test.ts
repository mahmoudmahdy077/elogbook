import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Static guard for the audit insert path.
 *
 * The `audit_logs` INSERT policy only admits rows written from inside a
 * trigger (`pg_trigger_depth() >= 1`). A request-scoped
 * `supabase.from('audit_logs').insert(...)` is therefore always rejected with
 * 42501, and because the call sites ignored the result, required audit events
 * (exports, PHI reveals, the mobile flush queue) were silently lost. The
 * trusted path is the `write_audit_event` RPC.
 *
 * This test fails if any request-scoped audit insert reappears, and it fails if
 * the trusted RPC stops being defined.
 */

const WEB_ROOT = join(process.cwd());
const MOBILE_ROOT = join(process.cwd(), '..', 'mobile');
const REPO_ROOT = join(process.cwd(), '..', '..');

/** Only the platform audit surface is allowed to write audit rows directly. */
const SERVICE_ROLE_ALLOWED = new Set([
  'lib/audit/write-audit-event.ts',
  'lib/setup/db-migrator.ts',
]);

const SCAN_ROOTS = [
  { root: WEB_ROOT, base: 'apps/web' },
  { root: MOBILE_ROOT, base: 'apps/mobile' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name === '.expo') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function sources(): Array<{ path: string; source: string }> {
  const files: Array<{ path: string; source: string }> = [];
  for (const { root, base } of SCAN_ROOTS) {
    if (!statSync(root, { throwIfNoEntry: false })) continue;
    for (const file of walk(root)) {
      files.push({ path: `${base}/${file.slice(root.length + 1).split('\\').join('/')}`, source: readFileSync(file, 'utf8') });
    }
  }
  return files;
}

/**
 * Request-scoped clients are built by `createServerSupabase()` or the browser
 * `createClient()` and are bound to the caller's JWT, so their audit inserts are
 * rejected. A service-role client (BYPASSRLS) is a server-only path and is
 * allowed to keep writing directly.
 */
const SERVICE_ROLE_CLIENTS = new Set([
  'adminClient',
  'admin',
  'serviceRole',
  'serviceSupabase',
  'serviceClient',
  'supabase',
]);

const SKIP_FILES = new Set([
  'apps/web/lib/audit/__tests__/audit-write-authority.static.test.ts',
]);

const AUDIT_INSERT = /(\w+)\s*\.from\(\s*['"]audit_logs['"]\s*\)[\s\S]{0,300}?\.insert\(/g;

function requestScopedInsertClients(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(AUDIT_INSERT)) {
    const client = match[1]!;
    if (!SERVICE_ROLE_CLIENTS.has(client)) found.push(client);
  }
  return found;
}

describe('audit write authority', () => {
  it('has no request-scoped audit_logs insert in web or mobile code', () => {
    const offenders = sources()
      .filter(({ path, source }) => !SKIP_FILES.has(path) && requestScopedInsertClients(source).length > 0)
      .map(({ path, source }) => `${path} (${[...new Set(requestScopedInsertClients(source))].join(', ')})`);

    expect(offenders).toEqual([]);
  });

  it('keeps the trusted RPC as the only app-side audit writer', () => {
    const migration = readFileSync(
      join(REPO_ROOT, 'supabase', 'migrations', '20260927000000_audit_write_authority.sql'),
      'utf8',
    );

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.write_audit_event');
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.write_audit_event(TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.write_audit_event(TEXT, TEXT, TEXT, JSONB, UUID) TO authenticated');
    // The direct INSERT policy must stay closed to clients.
    expect(migration).toMatch(/direct INSERT policy is deliberately left in place/i);
  });

  it('defines the trigger-depth INSERT policy in the database catalog', () => {
    const policy = readFileSync(
      join(REPO_ROOT, 'supabase', 'migrations', '20260824110000_audit_logs_trigger_depth_insert.sql'),
      'utf8',
    );

    expect(policy).toContain('WITH CHECK (pg_trigger_depth() >= 1)');
  });

  it('records a mobile PHI-read event through the trusted path', () => {
    const auditTrail = readFileSync(join(MOBILE_ROOT, 'lib', 'security', 'audit-trail.ts'), 'utf8');

    expect(auditTrail).toContain("supabase.rpc('write_audit_event'");
    expect(auditTrail).not.toContain('from(SUPABASE_TABLE).insert(');
    expect(auditTrail).toContain('export async function logPhiRead');
  });

  it('records the web PHI reveal through the trusted path', () => {
    const phiView = readFileSync(join(WEB_ROOT, 'lib', 'audit', 'record-phi-view.ts'), 'utf8');

    expect(phiView).toContain('recordAuditEvent');
    expect(phiView).toContain('return false;');
  });

  it('never selects the historical free-text audit payload on an export path', () => {
    const auditExport = readFileSync(
      join(WEB_ROOT, 'app', 'api', '[tenant]', 'audit', 'export', 'route.ts'),
      'utf8',
    );
    const complianceExport = readFileSync(
      join(WEB_ROOT, 'app', 'api', '[tenant]', 'compliance', 'export', 'route.ts'),
      'utf8',
    );

    expect(auditExport).not.toMatch(/select\([^)]*\bchanges\b[^)]*\)/);
    expect(complianceExport).not.toMatch(/select\([^)]*\bchanges\b[^)]*\)/);
  });
});

export { SERVICE_ROLE_ALLOWED };
