import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// T16: update management is platform-operator-only with honest executor
// states. Tenant admins/directors are denied by API (and UI); without the
// durable executor nothing pretends to update.

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({ __testClient: true })),
}));
vi.mock('@/lib/supabase/require-platform-admin', () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: vi.fn(() => 'test-ip') }));
vi.mock('@/lib/setup/backup-manager', () => ({ listBackups: vi.fn(() => []) }));
vi.mock('child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('execSync must not run in management tests');
  }),
  default: {},
}));

import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { listBackups } from '@/lib/setup/backup-manager';
import { GET as checkGet } from '../check/route';
import { POST as executePost } from '../execute/route';

type GuardResult = Awaited<ReturnType<typeof requirePlatformAdmin>>;
const OPERATOR = {
  ok: true as const,
  user: { id: 'u1' },
  operator: { user_id: 'u1' },
  profile: { id: 'p1', tenant_id: 't1' },
} as unknown as GuardResult;
const DENIED = {
  ok: false as const,
  error: 'Platform access required',
  status: 403 as const,
} as unknown as GuardResult;

function postReq(body: unknown) {
  return new Request('http://localhost/api/update/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': '10' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/update/check (T16)', () => {
  const OLD_MARKER = process.env.SETUP_COMPLETE_PATH;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { mkdtempSync, writeFileSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const dir = mkdtempSync(join(tmpdir(), 'setup-marker-'));
    const marker = join(dir, '.setup-complete');
    writeFileSync(marker, 'ok');
    process.env.SETUP_COMPLETE_PATH = marker;
  });

  afterEach(() => {
    if (OLD_MARKER === undefined) delete process.env.SETUP_COMPLETE_PATH;
    else process.env.SETUP_COMPLETE_PATH = OLD_MARKER;
  });

  it('denies tenant admins/directors with 403', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(DENIED);
    const res = await checkGet();
    expect(res.status).toBe(403);
  });

  it('reports version states plus backup status to operators', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    vi.mocked(listBackups).mockReturnValue([
      { backup_id: 'b1', created_at: '2026-09-01T00:00:00.000Z', size_bytes: 10 } as never,
    ]);
    const res = await checkGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backup).toMatchObject({ count: 1, latest_at: '2026-09-01T00:00:00.000Z' });
    expect(body).toHaveProperty('elogbook');
    expect(body).toHaveProperty('supabase');
  });
});

describe('POST /api/update/execute (T16)', () => {
  const OLD_FLAG = process.env.ELOGBOOK_LEGACY_UPDATER;
  const OLD_MARKER = process.env.SETUP_COMPLETE_PATH;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.ELOGBOOK_LEGACY_UPDATER;
    const { mkdtempSync, writeFileSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const dir = mkdtempSync(join(tmpdir(), 'setup-marker-'));
    const marker = join(dir, '.setup-complete');
    writeFileSync(marker, 'ok');
    process.env.SETUP_COMPLETE_PATH = marker;
  });

  afterEach(() => {
    if (OLD_FLAG === undefined) delete process.env.ELOGBOOK_LEGACY_UPDATER;
    else process.env.ELOGBOOK_LEGACY_UPDATER = OLD_FLAG;
    if (OLD_MARKER === undefined) delete process.env.SETUP_COMPLETE_PATH;
    else process.env.SETUP_COMPLETE_PATH = OLD_MARKER;
  });

  it('denies non-operators with 403', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(DENIED);
    const res = await executePost(postReq({ component: 'elogbook' }));
    expect(res.status).toBe(403);
  });

  it('returns 503 (honest unavailable) without the legacy escape hatch', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    const res = await executePost(postReq({ component: 'elogbook' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/durable|executor|unavailable/i);
  });

  it('still validates input with the hatch open (no shell without valid input)', async () => {
    process.env.ELOGBOOK_LEGACY_UPDATER = 'true';
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    const res = await executePost(postReq({ component: 'nonsense' }));
    expect(res.status).toBe(400);
  });
});
