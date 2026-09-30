import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Control-plane backup (platform authority only).
//
// Backup is a host-wide operation: it reads the installation's database
// credentials and reports the contents of every tenant. Authority therefore
// comes from the platform-admin registry plus server-verified AAL2 — a tenant
// `admin`/`institution_admin` label and `NODE_ENV` confer nothing.

const state = vi.hoisted(() => ({
  spec: null as unknown,
  auditRows: [] as Record<string, unknown>[],
  serverClient: null as unknown,
  serviceClient: null as unknown,
}));

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => state.serverClient) }));
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn(() => state.serviceClient) }));
vi.mock('@/lib/setup/backup-manager', () => ({
  createFullBackup: vi.fn(),
  listBackups: vi.fn(() => []),
}));

import {
  buildServerClientStub,
  buildServiceRoleStub,
  operatorSpec,
  tenantAdminSpec,
  type AuditRow,
  type PrincipalSpec,
} from '@/lib/supabase/__tests__/platform-guard-fixture';
import { createFullBackup, listBackups } from '@/lib/setup/backup-manager';
import { GET, POST } from '../route';

const PASSWORD = ['fixture', 'database', 'password'].join('-');
const LIVE_DATABASE = 'elogbook';
const OTHER_TENANT = 'tenant-uuid-0000-0000-00000000dead';

function applyPrincipal(spec: PrincipalSpec): void {
  state.spec = spec;
  state.auditRows = [];
  state.serverClient = buildServerClientStub(spec);
  state.serviceClient = buildServiceRoleStub(spec, state.auditRows);
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const payload = JSON.stringify(body);
  return new Request('http://localhost/api/backup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      'content-length': String(Buffer.byteLength(payload)),
      ...headers,
    },
    body: payload,
  });
}

function expectNoStore(response: Response): void {
  const cacheControl = response.headers.get('cache-control') ?? '';
  expect(cacheControl).toContain('no-store');
}

describe('GET /api/backup (control plane)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listBackups).mockReturnValue([]);
  });

  it('denies an unauthenticated caller with 401', async () => {
    applyPrincipal(operatorSpec({ userId: null }));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listBackups).not.toHaveBeenCalled();
  });

  it('denies a tenant admin with 403 and reveals no backup inventory', async () => {
    applyPrincipal(tenantAdminSpec());
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listBackups).not.toHaveBeenCalled();
    expect(await res.text()).not.toMatch(/backup_id/);
    expectNoStore(res);
  });

  it('denies a platform operator below AAL2 with 403', async () => {
    applyPrincipal(operatorSpec({ aal: 'aal1' }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listBackups).not.toHaveBeenCalled();
  });

  it('denies a platform operator with an inactive profile', async () => {
    applyPrincipal(operatorSpec({
      profile: { id: 'profile-uuid-0000-0000-000000000001', tenant_id: 'tenant-uuid-0000-0000-0000000000a1', status: 'suspended' },
    }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listBackups).not.toHaveBeenCalled();
  });

  it('denies a suspended platform registry row', async () => {
    applyPrincipal(operatorSpec({ registryRow: { user_id: 'operator-user-uuid', status: 'suspended' } }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listBackups).not.toHaveBeenCalled();
  });

  it('allows an AAL2 platform operator and marks the response no-store', async () => {
    applyPrincipal(operatorSpec());
    vi.mocked(listBackups).mockReturnValue([
      { backup_id: 'b1', created_at: '2026-09-01T00:00:00.000Z', size_bytes: 10 } as never,
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backups).toHaveLength(1);
    expectNoStore(res);
  });
});

describe('POST /api/backup (control plane)', () => {
  let dir: string;
  let configPath: string;
  let markerPath: string;
  const oldConfigPath = process.env.SUPABASE_CONFIG_PATH;
  const oldMarker = process.env.SETUP_COMPLETE_PATH;

  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'backup-route-'));
    configPath = join(dir, 'supabase-config.json');
    markerPath = join(dir, '.setup-complete');
    writeFileSync(configPath, JSON.stringify({ postgresDb: LIVE_DATABASE, postgresPassword: PASSWORD, installPath: '/opt/elogbook' }));
    writeFileSync(markerPath, 'ok');
    process.env.SUPABASE_CONFIG_PATH = configPath;
    process.env.SETUP_COMPLETE_PATH = markerPath;
    vi.mocked(listBackups).mockReturnValue([]);
    vi.mocked(createFullBackup).mockResolvedValue({
      backup_id: '2026-09-01T00-00-00-000Z',
      durability: 'durable',
      size_bytes: 42,
      created_at: '2026-09-01T00:00:00.000Z',
      artifacts: [{ name: 'database.sql.gz.enc', kind: 'database', sha256: 'a'.repeat(64) }],
    } as never);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (oldConfigPath === undefined) delete process.env.SUPABASE_CONFIG_PATH;
    else process.env.SUPABASE_CONFIG_PATH = oldConfigPath;
    if (oldMarker === undefined) delete process.env.SETUP_COMPLETE_PATH;
    else process.env.SETUP_COMPLETE_PATH = oldMarker;
  });

  it('denies a tenant admin with 403 before any backup runs', async () => {
    applyPrincipal(tenantAdminSpec());
    const res = await POST(postRequest({ type: 'manual' }));
    expect(res.status).toBe(403);
    expect(createFullBackup).not.toHaveBeenCalled();
  });

  it('denies a platform operator below AAL2 with 403 before any backup runs', async () => {
    applyPrincipal(operatorSpec({ aal: 'aal1' }));
    const res = await POST(postRequest({ type: 'manual' }));
    expect(res.status).toBe(403);
    expect(createFullBackup).not.toHaveBeenCalled();
  });

  it('denies an unauthenticated caller with 401', async () => {
    applyPrincipal(operatorSpec({ userId: null }));
    const res = await POST(postRequest({ type: 'manual' }));
    expect(res.status).toBe(401);
    expect(createFullBackup).not.toHaveBeenCalled();
  });

  it('rejects a body that names another tenant', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(postRequest({ type: 'manual', tenantId: OTHER_TENANT }));
    expect(res.status).toBe(400);
    expect(createFullBackup).not.toHaveBeenCalled();
    expect(state.auditRows).toHaveLength(0);
  });

  it('creates a backup for an AAL2 operator without echoing credentials', async () => {
    applyPrincipal(operatorSpec());
    const res = await POST(postRequest({ type: 'manual' }));
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized.toLowerCase()).not.toContain('password');
    expectNoStore(res);
    expect(createFullBackup).toHaveBeenCalledTimes(1);
  });

  it('audits metadata only, scoped to the operator tenant, with no secrets', async () => {
    applyPrincipal(operatorSpec());
    await POST(postRequest({ type: 'manual' }));
    const rows = state.auditRows as AuditRow[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.action).toBe('backup_created');
    expect(row.tenant_id).toBe('tenant-uuid-0000-0000-0000000000a1');
    expect(row.resource_id).toBe('profile-uuid-0000-0000-000000000001');
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(JSON.stringify(row)).not.toMatch(/postgresPassword|service_role_key/i);
  });

  it('never returns a raw backup error or secret in the failure body', async () => {
    applyPrincipal(operatorSpec());
    vi.mocked(createFullBackup).mockRejectedValue(
      new Error(`pg_dump failed for ${PASSWORD} at ${readFileSync(configPath, 'utf8')}`),
    );
    const res = await POST(postRequest({ type: 'manual' }));
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toMatch(/pg_dump|postgresPassword/i);
    expectNoStore(res);
  });

  it('refuses when the installation is not configured, without leaking the config', async () => {
    applyPrincipal(operatorSpec());
    rmSync(configPath);
    const res = await POST(postRequest({ type: 'manual' }));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(PASSWORD);
    expect(createFullBackup).not.toHaveBeenCalled();
  });
});
