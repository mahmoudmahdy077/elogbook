import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Control-plane restore (platform authority only, server-owned target).
//
// The caller supplies an opaque target id and an explicit disposable
// confirmation. The database name is derived by the server inside a private
// namespace and must be a target the operator provisioned on this
// installation. A caller-supplied `targetDatabase` is refused by the schema
// before any authority check is even consulted.

const state = vi.hoisted(() => ({
  spec: null as unknown,
  auditRows: [] as Record<string, unknown>[],
  serverClient: null as unknown,
  serviceClient: null as unknown,
}));

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => state.serverClient) }));
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn(() => state.serviceClient) }));
vi.mock('@/lib/setup/backup-manager', () => ({ restoreFromBackup: vi.fn() }));
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: vi.fn(() => 'test-ip') }));

import {
  buildServerClientStub,
  buildServiceRoleStub,
  operatorSpec,
  tenantAdminSpec,
  type AuditRow,
  type PrincipalSpec,
} from '@/lib/supabase/__tests__/platform-guard-fixture';
import { restoreFromBackup } from '@/lib/setup/backup-manager';
import { POST } from '../route';

const PASSWORD = ['fixture', 'database', 'password'].join('-');
const LIVE_DATABASE = 'elogbook';
const OTHER_TENANT = 'tenant-uuid-0000-0000-00000000dead';
const ALLOWED_TARGET = 'drill_1';

function applyPrincipal(spec: PrincipalSpec): void {
  state.spec = spec;
  state.auditRows = [];
  state.serverClient = buildServerClientStub(spec);
  state.serviceClient = buildServiceRoleStub(spec, state.auditRows);
}

function restoreRequest(body: unknown): Request {
  const payload = JSON.stringify(body);
  return new Request('http://localhost/api/backup/restore', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'content-length': String(Buffer.byteLength(payload)),
    },
    body: payload,
  });
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { backupId: '2026-09-01T00-00-00-000Z', restoreTargetId: ALLOWED_TARGET, confirmDisposableTarget: true, ...overrides };
}

describe('POST /api/backup/restore (control plane)', () => {
  let dir: string;
  const oldConfigPath = process.env.SUPABASE_CONFIG_PATH;
  const oldMarker = process.env.SETUP_COMPLETE_PATH;
  const oldAllowlist = process.env.RESTORE_TARGET_ALLOWLIST;
  const oldCheckHook = process.env.POST_RESTORE_CHECK_HOOK;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'restore-route-'));
    const configPath = join(dir, 'supabase-config.json');
    writeFileSync(configPath, JSON.stringify({ postgresDb: LIVE_DATABASE, postgresPassword: PASSWORD }));
    const markerPath = join(dir, '.setup-complete');
    writeFileSync(markerPath, 'ok');
    process.env.SUPABASE_CONFIG_PATH = configPath;
    process.env.SETUP_COMPLETE_PATH = markerPath;
    process.env.RESTORE_TARGET_ALLOWLIST = ALLOWED_TARGET;
    process.env.POST_RESTORE_CHECK_HOOK = join(dir, 'post-check.sh');
    vi.mocked(restoreFromBackup).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (oldConfigPath === undefined) delete process.env.SUPABASE_CONFIG_PATH;
    else process.env.SUPABASE_CONFIG_PATH = oldConfigPath;
    if (oldMarker === undefined) delete process.env.SETUP_COMPLETE_PATH;
    else process.env.SETUP_COMPLETE_PATH = oldMarker;
    if (oldAllowlist === undefined) delete process.env.RESTORE_TARGET_ALLOWLIST;
    else process.env.RESTORE_TARGET_ALLOWLIST = oldAllowlist;
    if (oldCheckHook === undefined) delete process.env.POST_RESTORE_CHECK_HOOK;
    else process.env.POST_RESTORE_CHECK_HOOK = oldCheckHook;
  });

  it('rejects a caller-supplied target database name outright', async () => {
    applyPrincipal(operatorSpec());
    for (const targetDatabase of ['postgres', 'template1', 'elogbook_restore_evil']) {
      const res = await POST(restoreRequest({ backupId: 'b1', targetDatabase, disposableTarget: true }));
      expect(res.status).toBe(400);
    }
    expect(restoreFromBackup).not.toHaveBeenCalled();
  });

  it('denies a tenant admin with 403 before resolving any target', async () => {
    applyPrincipal(tenantAdminSpec());
    const res = await POST(restoreRequest(validBody()));
    expect(res.status).toBe(403);
    expect(restoreFromBackup).not.toHaveBeenCalled();
  });

  it('denies a platform operator below AAL2 with 403', async () => {
    applyPrincipal(operatorSpec({ aal: 'aal1' }));
    const res = await POST(restoreRequest(validBody()));
    expect(res.status).toBe(403);
    expect(restoreFromBackup).not.toHaveBeenCalled();
  });

  it('denies an unauthenticated caller with 401', async () => {
    applyPrincipal(operatorSpec({ userId: null }));
    const res = await POST(restoreRequest(validBody()));
    expect(res.status).toBe(401);
    expect(restoreFromBackup).not.toHaveBeenCalled();
  });

  it('rejects a body that names another tenant', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(restoreRequest(validBody({ tenantId: OTHER_TENANT })));
    expect(res.status).toBe(400);
    expect(restoreFromBackup).not.toHaveBeenCalled();
    expect(state.auditRows).toHaveLength(0);
  });

  it('requires an explicit disposable-target confirmation', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(restoreRequest({ backupId: 'b1', restoreTargetId: ALLOWED_TARGET }));
    expect(res.status).toBe(400);
    expect(restoreFromBackup).not.toHaveBeenCalled();
  });

  it('refuses a target that was never provisioned on this installation', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(restoreRequest(validBody({ restoreTargetId: 'drill_2' })));
    expect(res.status).toBe(400);
    expect(restoreFromBackup).not.toHaveBeenCalled();
  });

  it('refuses a system database named as a target', async () => {
    process.env.RESTORE_TARGET_ALLOWLIST = 'drill_1,postgres';
    applyPrincipal(operatorSpec());
    const res = await POST(restoreRequest(validBody({ restoreTargetId: 'postgres' })));
    expect(res.status).toBe(400);
    expect(restoreFromBackup).not.toHaveBeenCalled();
  });

  it('fails closed when no disposable target is provisioned', async () => {
    process.env.RESTORE_TARGET_ALLOWLIST = '';
    applyPrincipal(operatorSpec());
    const res = await POST(restoreRequest(validBody()));
    expect(res.status).toBe(400);
    expect(restoreFromBackup).not.toHaveBeenCalled();
  });

  it('restores into the server-derived disposable database name', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(restoreRequest(validBody()));
    expect(res.status).toBe(200);
    const [, dbConfig, options] = vi.mocked(restoreFromBackup).mock.calls[0];
    expect(dbConfig).toMatchObject({ database: LIVE_DATABASE });
    expect(options).toMatchObject({ targetDatabase: 'elogbook_restore_drill_1', disposableTarget: true });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('audits the drill in the operator tenant with no secrets', async () => {
    applyPrincipal(operatorSpec());
    await POST(restoreRequest(validBody()));
    const rows = state.auditRows as AuditRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('backup_restored');
    expect(rows[0].tenant_id).toBe('tenant-uuid-0000-0000-0000000000a1');
    expect(rows[0].resource_id).toBe('profile-uuid-0000-0000-000000000001');
    expect(JSON.stringify(rows[0])).not.toContain(PASSWORD);
  });

  it('never surfaces a restore engine error or secret to the caller', async () => {
    applyPrincipal(operatorSpec());
    vi.mocked(restoreFromBackup).mockResolvedValue({ success: false, error: `psql auth failed: ${PASSWORD}` });
    const res = await POST(restoreRequest(validBody()));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toMatch(/psql|auth failed/i);
  });
});
