import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Control-plane uninstall (platform authority only).
//
// Uninstall tears down containers, volumes, and installation paths for every
// tenant. Authority is the platform-admin registry plus server-verified AAL2 —
// a tenant `admin` role label is explicitly not sufficient. The operation is
// serialized by a durable lease and is idempotent per scope, and it never
// returns a raw child-process or filesystem error.

const state = vi.hoisted(() => ({
  spec: null as unknown,
  auditRows: [] as Record<string, unknown>[],
  serverClient: null as unknown,
  serviceClient: null as unknown,
}));

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => state.serverClient) }));
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn(() => state.serviceClient) }));
vi.mock('@/lib/setup/backup-manager', () => ({ createFullBackup: vi.fn(async () => ({ durability: 'durable' })) }));
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: vi.fn(() => 'test-ip') }));
vi.mock('@/lib/setup/host-exec', () => ({ runDocker: vi.fn() }));

import {
  buildServerClientStub,
  buildServiceRoleStub,
  operatorSpec,
  tenantAdminSpec,
  type AuditRow,
  type PrincipalSpec,
} from '@/lib/supabase/__tests__/platform-guard-fixture';
import { runDocker } from '@/lib/setup/host-exec';
import { POST } from '../route';

const PASSWORD = ['fixture', 'database', 'password'].join('-');
const OTHER_TENANT = 'tenant-uuid-0000-0000-00000000dead';

function applyPrincipal(spec: PrincipalSpec): void {
  state.spec = spec;
  state.auditRows = [];
  state.serverClient = buildServerClientStub(spec);
  state.serviceClient = buildServiceRoleStub(spec, state.auditRows);
}

function uninstallRequest(body: unknown): Request {
  const payload = JSON.stringify(body);
  return new Request('http://localhost/api/uninstall', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'content-length': String(Buffer.byteLength(payload)),
    },
    body: payload,
  });
}

describe('POST /api/uninstall (control plane)', () => {
  let dir: string;
  const oldConfigPath = process.env.SUPABASE_CONFIG_PATH;
  const oldMarker = process.env.SETUP_COMPLETE_PATH;
  const oldStateDir = process.env.SETUP_STATE_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'uninstall-route-'));
    const configPath = join(dir, 'supabase-config.json');
    writeFileSync(configPath, JSON.stringify({ postgresDb: 'elogbook', postgresPassword: PASSWORD, installPath: '/opt/elogbook' }));
    const markerPath = join(dir, '.setup-complete');
    writeFileSync(markerPath, 'ok');
    process.env.SUPABASE_CONFIG_PATH = configPath;
    process.env.SETUP_COMPLETE_PATH = markerPath;
    process.env.SETUP_STATE_DIR = join(dir, 'state');
    applyPrincipal(operatorSpec());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (oldConfigPath === undefined) delete process.env.SUPABASE_CONFIG_PATH;
    else process.env.SUPABASE_CONFIG_PATH = oldConfigPath;
    if (oldMarker === undefined) delete process.env.SETUP_COMPLETE_PATH;
    else process.env.SETUP_COMPLETE_PATH = oldMarker;
    if (oldStateDir === undefined) delete process.env.SETUP_STATE_DIR;
    else process.env.SETUP_STATE_DIR = oldStateDir;
  });

  it('denies a tenant admin with 403 and runs nothing', async () => {
    applyPrincipal(tenantAdminSpec());
    const res = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    expect(res.status).toBe(403);
    expect(runDocker).not.toHaveBeenCalled();
  });

  it('denies a platform operator below AAL2 with 403 and runs nothing', async () => {
    applyPrincipal(operatorSpec({ aal: 'aal1' }));
    const res = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    expect(res.status).toBe(403);
    expect(runDocker).not.toHaveBeenCalled();
  });

  it('denies an unauthenticated caller with 401', async () => {
    applyPrincipal(operatorSpec({ userId: null }));
    const res = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    expect(res.status).toBe(401);
    expect(runDocker).not.toHaveBeenCalled();
  });

  it('denies an AAL2 operator with no verified MFA factor', async () => {
    applyPrincipal(operatorSpec({ factors: [] }));
    const res = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    expect(res.status).toBe(403);
    expect(runDocker).not.toHaveBeenCalled();
  });

  it('rejects a body that names another tenant and runs nothing', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE', tenantId: OTHER_TENANT }));
    expect(res.status).toBe(400);
    expect(runDocker).not.toHaveBeenCalled();
    expect(state.auditRows).toHaveLength(0);
  });

  it('rejects a body without the explicit confirmation', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(uninstallRequest({ scope: 'stop' }));
    expect(res.status).toBe(400);
    expect(runDocker).not.toHaveBeenCalled();
  });

  it('refuses a concurrent second uninstall with 409', async () => {
    applyPrincipal(operatorSpec());
    const { acquireDurableLock, releaseDurableLock } = await import('@/lib/setup/guard');
    expect(acquireDurableLock('uninstall')).toBe(true);
    try {
      const res = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
      expect(res.status).toBe(409);
      expect(runDocker).not.toHaveBeenCalled();
    } finally {
      releaseDurableLock('uninstall');
    }
  });

  it('is idempotent for an already-applied scope', async () => {
    applyPrincipal(operatorSpec());
    const first = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    expect(first.status).toBe(200);
    expect((await first.json()).alreadyApplied).toBe(false);
    const callsAfterFirst = vi.mocked(runDocker).mock.calls.length;

    const second = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    expect(second.status).toBe(200);
    expect((await second.json()).alreadyApplied).toBe(true);
    expect(vi.mocked(runDocker).mock.calls.length).toBe(callsAfterFirst);
  });

  it('audits the request in the operator tenant with a uuid resource id and no secrets', async () => {
    applyPrincipal(operatorSpec());
    await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    const rows = state.auditRows as AuditRow[];
    const request = rows.find((row) => row.action === 'uninstall_requested');
    expect(request).toBeDefined();
    expect(request?.tenant_id).toBe('tenant-uuid-0000-0000-0000000000a1');
    expect(request?.resource_id).toBe('profile-uuid-0000-0000-000000000001');
    expect(JSON.stringify(request)).not.toContain(PASSWORD);
  });

  it('never returns a raw child-process error or secret', async () => {
    applyPrincipal(operatorSpec());
    vi.mocked(runDocker).mockImplementation(() => {
      throw new Error(`compose failed using ${PASSWORD}`);
    });
    const res = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toMatch(/compose failed/i);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('marks the response no-store on success', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(uninstallRequest({ scope: 'stop', confirm: 'DELETE' }));
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});
