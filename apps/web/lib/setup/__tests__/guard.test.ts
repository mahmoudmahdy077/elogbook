import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkSetupRequest,
  tryAcquireSetupLock,
  releaseSetupLock,
  resetSetupLocksForTests,
  checkRateLimit,
  resetRateLimitsForTests,
  clientIpFromHeaders,
  consumeSetupToken,
  acquireDurableLock,
  releaseDurableLock,
  adminInputSchema,
  migrateInputSchema,
  type SetupRequest,
} from '../guard';

function req(over: Partial<SetupRequest> = {}): SetupRequest {
  return {
    url: 'http://localhost:3000/api/setup/migrate',
    method: 'POST',
    headers: {},
    ip: '127.0.0.1',
    ...over,
  };
}

const MODE_ON = { SETUP_MODE: 'true', NODE_ENV: 'development' };
const noMarker = { markerExists: () => false };
const doneMarker = { markerExists: () => true };

beforeEach(() => {
  resetSetupLocksForTests();
  resetRateLimitsForTests();
});

describe('setup guard (M8.1)', () => {
  it('returns 404 in production builds', () => {
    expect(
      checkSetupRequest(req(), 'migrate', { SETUP_MODE: 'true', NODE_ENV: 'production' }, noMarker).ok,
    ).toBe(false);
    expect(
      checkSetupRequest(req(), 'migrate', { SETUP_MODE: 'true', NODE_ENV: 'production' }, noMarker),
    ).toMatchObject({ status: 404 });
  });

  it('denies anonymous setup-mode-off and post-completion requests', () => {
    expect(
      checkSetupRequest(req(), 'migrate', { NODE_ENV: 'development' }, noMarker),
    ).toMatchObject({ ok: false, status: 403 });
    expect(checkSetupRequest(req(), 'migrate', MODE_ON, doneMarker)).toMatchObject({ ok: false, status: 403 });
  });

  it('requires the bootstrap token when configured', () => {
    const env = { ...MODE_ON, SETUP_BOOTSTRAP_TOKEN: 'one-time-secret' };
    expect(checkSetupRequest(req(), 'migrate', env, noMarker)).toMatchObject({ ok: false, status: 401 });
    expect(
      checkSetupRequest(req({ headers: { 'x-setup-token': 'wrong' } }), 'migrate', env, noMarker),
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      checkSetupRequest(req({ headers: { 'x-setup-token': 'one-time-secret' } }), 'migrate', env, noMarker),
    ).toMatchObject({ ok: true });
  });

  it('allows localhost-bound requests without a token, denies remote ones', () => {
    expect(checkSetupRequest(req(), 'migrate', MODE_ON, noMarker)).toMatchObject({ ok: true });
    expect(
      checkSetupRequest(req({ url: 'http://192.168.1.10:3000/api/setup/migrate', ip: '192.168.1.10' }), 'migrate', MODE_ON, noMarker),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects cross-origin requests that lack the token', () => {
    const r = req({ headers: { origin: 'https://evil.example' } });
    expect(checkSetupRequest(r, 'migrate', MODE_ON, noMarker)).toMatchObject({ ok: false, status: 403 });
  });

  it('rate-limits anonymous bursts per ip+operation', () => {
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit('10.0.0.9', 'migrate', 1_000 + i * 100).ok).toBe(true);
    }
    expect(checkRateLimit('10.0.0.9', 'migrate', 2_000)).toMatchObject({ ok: false, status: 429 });
  });

  it('serializes mutating operations (no concurrent second executor)', () => {
    expect(tryAcquireSetupLock('deploy-supabase')).toBe(true);
    expect(tryAcquireSetupLock('deploy-supabase')).toBe(false);
    releaseSetupLock('deploy-supabase');
    expect(tryAcquireSetupLock('deploy-supabase')).toBe(true);
  });

  it('validates admin and migrate inputs strictly', () => {
    expect(adminInputSchema.safeParse({ email: 'not-an-email', password: 'short', fullName: 'x' }).success).toBe(false);
    expect(
      adminInputSchema.safeParse({ email: 'a@b.co', password: 'long-enough-pass', fullName: 'Ada' }).success,
    ).toBe(true);
    expect(migrateInputSchema.safeParse({ host: 'db; rm -rf /', port: 5432 }).success).toBe(false);
    expect(migrateInputSchema.safeParse({ host: 'db', port: 99999 }).success).toBe(false);
    expect(migrateInputSchema.safeParse({ host: 'db', port: 5432, database: 'supabase', user: 'postgres', password: 'pw' }).success).toBe(true);
  });

  describe('N9 hardening (proxy trust, one-time token, durable lock)', () => {
    let dir: string;
    const OLD_STATE = process.env.SETUP_STATE_DIR;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'setup-guard-'));
      process.env.SETUP_STATE_DIR = dir;
    });
    afterEach(() => {
      if (OLD_STATE === undefined) delete process.env.SETUP_STATE_DIR;
      else process.env.SETUP_STATE_DIR = OLD_STATE;
      rmSync(dir, { recursive: true, force: true });
    });

    it('derives the client IP from trusted proxy hops only', () => {
      const h = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' };
      // No trust configured: forwarded chain is untrusted, direct peer unknown.
      expect(clientIpFromHeaders(h, 0)).toBe('direct');
      // One trusted hop: client is the leftmost untrusted address.
      expect(clientIpFromHeaders(h, 1)).toBe('203.0.113.9');
      expect(clientIpFromHeaders({ 'x-forwarded-for': '203.0.113.9' }, 1)).toBe('203.0.113.9');
    });

    it('bounds token replay with durable single-use accounting', () => {
      process.env.SETUP_TOKEN_MAX_USES = '2';
      expect(consumeSetupToken('tok-1', 'tok-1').ok).toBe(true);
      expect(consumeSetupToken('tok-1', 'tok-1').ok).toBe(true);
      expect(consumeSetupToken('tok-1', 'tok-1')).toMatchObject({ ok: false, status: 429 });
      delete process.env.SETUP_TOKEN_MAX_USES;
    });

    it('holds durable locks across restarts and takes over stale leases', () => {
      expect(acquireDurableLock('migrate', 60_000)).toBe(true);
      expect(acquireDurableLock('migrate', 60_000)).toBe(false);
      releaseDurableLock('migrate');
      expect(acquireDurableLock('migrate', 60_000)).toBe(true);
      releaseDurableLock('migrate');
      // Stale lease (taken 20 min ago, 1 min TTL) is taken over.
      expect(acquireDurableLock('deploy', 60_000, Date.now() - 20 * 60_000)).toBe(true);
      releaseDurableLock('deploy');
    });
  });
});
