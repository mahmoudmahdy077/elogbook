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
  clientIpOfRequest,
  consumeSetupToken,
  acquireDurableLock,
  releaseDurableLock,
  writeSetupReceiptAtomically,
  verifySetupReceipts,
  removeSetupReceipt,
  adminInputSchema,
  migrateInputSchema,
  setupRuntimeEnabled,
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

const MODE_ON = {
  SETUP_MODE: 'true',
  SETUP_PHASE: 'setup',
  SETUP_BIND_ADDRESS: '127.0.0.1',
  SETUP_REMOTE_TLS_REQUIRED: 'true',
  APP_RELEASE_COMMIT: 'a'.repeat(40),
  NODE_ENV: 'development',
};
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

  it('allows only the explicit non-production setup phase', () => {
    const setupEnv = {
      SETUP_MODE: 'true',
      SETUP_PHASE: 'setup',
      SETUP_BIND_ADDRESS: '127.0.0.1',
      SETUP_REMOTE_TLS_REQUIRED: 'true',
      APP_RELEASE_COMMIT: 'a'.repeat(40),
      NODE_ENV: 'development',
    };
    expect(setupRuntimeEnabled(setupEnv)).toBe(true);
    expect(setupRuntimeEnabled({ ...setupEnv, NODE_ENV: 'production' })).toBe(false);
    expect(setupRuntimeEnabled({ ...setupEnv, APP_RELEASE_COMMIT: undefined })).toBe(false);
    expect(setupRuntimeEnabled({ SETUP_MODE: 'true', SETUP_PHASE: 'setup', NODE_ENV: 'production' })).toBe(false);
    expect(checkSetupRequest(req(), 'migrate', setupEnv, noMarker)).toMatchObject({ ok: true });
    expect(checkSetupRequest(req(), 'migrate', { ...setupEnv, NODE_ENV: 'production' }, noMarker)).toMatchObject({ ok: false, status: 404 });
  });

  it('requires TLS for a remote setup request even when a token is valid', () => {
    const env = { ...MODE_ON, SETUP_BOOTSTRAP_TOKEN: 'one-time-secret' };
    expect(
      checkSetupRequest(
        req({ url: 'http://setup.example.test/api/setup/migrate', headers: { 'x-setup-token': 'one-time-secret' } }),
        'migrate',
        env,
        noMarker,
      ),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      checkSetupRequest(
        req({ url: 'https://setup.example.test/api/setup/migrate', headers: { 'x-setup-token': 'one-time-secret' } }),
        'migrate',
        env,
        noMarker,
      ),
    ).toMatchObject({ ok: true });
    expect(
      checkSetupRequest(
        req({ url: 'http://setup.example.test/api/setup/migrate', headers: { 'x-setup-token': 'one-time-secret', 'x-forwarded-proto': 'https' } }),
        'migrate',
        env,
        noMarker,
      ),
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
    expect(migrateInputSchema.safeParse({}).success).toBe(true);
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

    it('delegates client IP derivation to the centralized trust policy', () => {
      const previousHops = process.env.TRUSTED_PROXY_HOPS;
      process.env.TRUSTED_PROXY_HOPS = '2';
      try {
        const request = new Request('http://localhost/api/setup/migrate', {
          headers: { 'x-forwarded-for': '198.51.100.77, 203.0.113.5, 10.0.0.1' },
        });
        expect(clientIpOfRequest(request)).toBe('203.0.113.5');
      } finally {
        if (previousHops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
        else process.env.TRUSTED_PROXY_HOPS = previousHops;
      }
    });

    it('allows local setup without a token but still requires one when configured', () => {
      expect(consumeSetupToken(undefined, undefined).ok).toBe(true);
      expect(consumeSetupToken(undefined, 'configured-token').ok).toBe(false);
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
      expect(acquireDurableLock('deploy', 60_000, Date.now() - 20 * 60_000)).toBe(true);
      releaseDurableLock('deploy');
    });

    it('requires every successful step receipt and supports cleanup', () => {
      const receipts = ['setup-deploy.json', 'migrations-applied.json', 'setup-admin.json', 'setup-domain.json'] as const;
      for (const receipt of receipts) {
        writeSetupReceiptAtomically(receipt, { success: true, applied: 1, errors: [] });
      }
      expect(verifySetupReceipts()).toEqual({ ok: true });
      removeSetupReceipt('setup-admin.json');
      expect(verifySetupReceipts()).toMatchObject({ ok: false });
    });
  });
});
