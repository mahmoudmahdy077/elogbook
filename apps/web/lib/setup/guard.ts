/**
 * M8.1 — setup control-plane guard.
 *
 * Setup routes run powerful operations (deploy Supabase/Docker, migrate,
 * create admin/tenant, write domain config, mark setup complete). Every
 * route must pass checkSetupRequest() before doing anything:
 *  - absent in production builds (404),
 *  - SETUP_MODE on + setup marker absent (403 otherwise),
 *  - localhost/bootstrapping boundary OR one-time bootstrap token (401),
 *  - same-origin or token-bearing requests only (403 on cross-origin),
 *  - per-IP+operation rate limit (429),
 * plus tryAcquireSetupLock() around execution (409 on concurrent executor),
 * strict zod input schemas, and auditSetup() records.
 */

import { timingSafeEqual } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { z } from 'zod';
import { getClientIp } from '../client-ip';

export interface SetupRequest {
  url: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip: string;
}

export interface SetupEnv {
  SETUP_MODE?: string;
  SETUP_PHASE?: string;
  SETUP_BIND_ADDRESS?: string;
  SETUP_REMOTE_TLS_REQUIRED?: string;
  SETUP_BOOTSTRAP_TOKEN?: string;
  APP_RELEASE_COMMIT?: string;
  NODE_ENV?: string;
}

export interface SetupFs {
  markerExists: () => boolean;
}

export type GuardVerdict = { ok: true } | { ok: false; status: number; error: string };

const deny = (status: number, error: string): GuardVerdict => ({ ok: false, status, error });

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export function setupRuntimeEnabled(env: SetupEnv = process.env as SetupEnv): boolean {
  const loopbackBind = env.SETUP_BIND_ADDRESS === '127.0.0.1'
    || env.SETUP_BIND_ADDRESS === '::1'
    || env.SETUP_BIND_ADDRESS === 'loopback';
  const releaseCommitValid = /^[0-9a-f]{40}$/i.test(env.APP_RELEASE_COMMIT ?? '');
  return env.NODE_ENV !== 'production'
    && env.SETUP_MODE === 'true'
    && env.SETUP_PHASE === 'setup'
    && env.SETUP_REMOTE_TLS_REQUIRED === 'true'
    && releaseCommitValid
    && loopbackBind;
}

export function writeSetupMarkerAtomically(
  markerPath = '/app/data/.setup-complete',
  value = new Date().toISOString(),
): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, markerPath);
}

export function removeSetupMarker(markerPath = '/app/data/.setup-complete'): void {
  try {
    unlinkSync(markerPath);
  } catch {
    void 0;
  }
}

export const setupReceiptNames = [
  'setup-deploy.json',
  'migrations-applied.json',
  'setup-admin.json',
  'setup-domain.json',
] as const;

export type SetupReceiptName = (typeof setupReceiptNames)[number];

function isSetupReceiptName(name: string): name is SetupReceiptName {
  return (setupReceiptNames as readonly string[]).includes(name);
}

export function writeSetupReceiptAtomically(
  name: SetupReceiptName,
  value: unknown,
  directory = stateDir(),
): void {
  if (!isSetupReceiptName(name)) throw new Error('Invalid setup receipt name');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function removeSetupReceipt(name: SetupReceiptName, directory = stateDir()): void {
  if (!isSetupReceiptName(name)) throw new Error('Invalid setup receipt name');
  try {
    unlinkSync(join(directory, name));
  } catch {
    void 0;
  }
}

export function verifySetupReceipts(directory = stateDir()): GuardVerdict {
  for (const name of setupReceiptNames) {
    let receipt: { success?: unknown; applied?: unknown; errors?: unknown };
    try {
      receipt = JSON.parse(readFileSync(join(directory, name), 'utf8')) as typeof receipt;
    } catch {
      return deny(409, `Setup incomplete: missing ${name}`);
    }
    if (!receipt || receipt.success !== true) return deny(409, `Setup incomplete: ${name} did not succeed`);
    if (name === 'migrations-applied.json') {
      if (!Number.isInteger(receipt.applied) || (receipt.applied as number) < 1) {
        return deny(409, 'Setup incomplete: migrations receipt has no applied migrations');
      }
      if (!Array.isArray(receipt.errors) || receipt.errors.length > 0) {
        return deny(409, 'Setup incomplete: migration receipt contains errors');
      }
    }
  }
  return { ok: true };
}

function protocolOf(url: string): string {
  try {
    return new URL(url).protocol.toLowerCase();
  } catch {
    return '';
  }
}

const defaultSetupFs: SetupFs = {
  markerExists: () => existsSync('/app/data/.setup-complete'),
};

export function checkSetupRequest(
  req: SetupRequest,
  _op: string,
  env: SetupEnv = process.env as SetupEnv,
  fs: SetupFs = defaultSetupFs,
): GuardVerdict {
  if (env.NODE_ENV === 'production') return deny(404, 'Not Found');
  if (!setupRuntimeEnabled(env) || fs.markerExists()) return deny(403, 'Setup not available');

  const host = hostOf(req.url);
  const configured = env.SETUP_BOOTSTRAP_TOKEN;
  const presented = req.headers['x-setup-token'];
  const tokenValid = !!configured && !!presented && tokensEqual(presented, configured);

  if (configured) {
    if (!tokenValid) return deny(401, 'Valid setup token required');
    if (!isLoopback(host) && env.SETUP_REMOTE_TLS_REQUIRED !== 'false') {
      const forwardedProtocol = req.headers['x-forwarded-proto'];
      if (protocolOf(req.url) !== 'https:' && forwardedProtocol?.toLowerCase() !== 'https') {
        return deny(403, 'TLS is required for remote setup requests');
      }
    }
  } else if (!isLoopback(host)) {
    // No token configured: localhost-bound bootstrapping only (fail-closed).
    return deny(401, 'Setup token not configured; localhost bootstrap only');
  }

  const origin = req.headers.origin ?? req.headers.Origin;
  const referer = req.headers.referer ?? req.headers.Referer;
  const remote = origin ?? referer;
  if (remote) {
    try {
      if (hostOf(remote) !== host && !tokenValid) {
        return deny(403, 'Cross-origin setup request requires a valid setup token');
      }
    } catch {
      return deny(403, 'Unparseable request origin');
    }
  }

  return { ok: true };
}

// --- Concurrency lock (one executor per operation) --------------------------

const locks = new Set<string>();

export function tryAcquireSetupLock(op: string): boolean {
  if (locks.has(op)) return false;
  locks.add(op);
  return true;
}

export function releaseSetupLock(op: string): void {
  locks.delete(op);
}

export function resetSetupLocksForTests(): void {
  locks.clear();
}

// --- Rate limit (20 req/min per ip+operation, in-memory) ---------------------

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const hits = new Map<string, number[]>();

export function checkRateLimit(ip: string, op: string, now = Date.now()): GuardVerdict {
  const key = `${ip}:${op}`;
  const window = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (window.length >= RATE_MAX) {
    hits.set(key, window);
    return deny(429, 'Rate limit exceeded');
  }
  window.push(now);
  hits.set(key, window);
  return { ok: true };
}

export function resetRateLimitsForTests(): void {
  hits.clear();
}

// --- Strict input schemas ----------------------------------------------------

const HOST_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const PG_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/;

export const adminInputSchema = z.object({
  email: z.email(),
  password: z.string().min(12).max(256),
  fullName: z.string().min(2).max(120),
});

export const migrateInputSchema = z.object({
  host: z.string().regex(HOST_RE).default('db'),
  port: z.number().int().min(1).max(65535).default(5432),
  database: z.string().regex(PG_IDENT_RE).default('supabase'),
  user: z.string().regex(PG_IDENT_RE).default('postgres'),
  password: z.string().min(1).max(512).optional(),
});

export const domainInputSchema = z.object({
  domain: z.string().min(1).max(253),
});

// --- Audit (best-effort JSONL; never throws) ----------------------------------

export function auditSetup(op: string, result: string, detail?: string): void {
  try {
    const path = process.env.SETUP_AUDIT_LOG ?? '/app/data/setup-audit.log';
    appendFileSync(
      path,
      `${JSON.stringify({ ts: new Date().toISOString(), op, result, detail: detail?.slice(0, 500) ?? null })}\n`,
      'utf-8',
    );
  } catch {
    // audit must never break setup
  }
}

// --- N9: trusted proxy client IP --------------------------------------------

export function clientIpOfRequest(request: Request): string {
  return getClientIp(request);
}

// --- N9: durable one-time token accounting ----------------------------------
// The static bootstrap token is replay-bounded: every accepted use is
// recorded in a durable counter (SETUP_STATE_DIR, default /app/data) and
// the token dies after SETUP_TOKEN_MAX_USES uses (default 50) or at setup
// completion (marker invalidates everything). Replay inside the window is
// still possible — rate limits + short setup windows bound it (ledger).

function stateDir(): string {
  return process.env.SETUP_STATE_DIR ?? '/app/data';
}

export function consumeSetupToken(presented: string | undefined, configured: string | undefined): GuardVerdict {
  if (!configured) return { ok: true };
  if (!presented || !tokensEqual(presented, configured)) {
    return deny(401, 'Valid setup token required');
  }
  const max = Math.max(1, Number(process.env.SETUP_TOKEN_MAX_USES ?? 50) || 50);
  const file = join(stateDir(), 'setup-token-uses.json');
  try {
    mkdirSync(stateDir(), { recursive: true });
  } catch {
    // state dir unavailable (local dev): fall back to single-process memory
    return { ok: true };
  }
  try {
    let uses = 0;
    try {
      uses = Number(JSON.parse(readFileSync(file, 'utf-8')).uses) || 0;
    } catch {
      uses = 0;
    }
    if (uses >= max) return deny(429, 'Setup token exhausted — rotate SETUP_BOOTSTRAP_TOKEN');
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ uses: uses + 1 }), 'utf-8');
    renameSync(tmp, file);
    return { ok: true };
  } catch {
    return deny(500, 'Token accounting unavailable');
  }
}

// --- N9: durable executor lock with stale-lease takeover --------------------
// Process-local locks die with the process (two installers could collide
// after a crash). The durable lock is a lease file; holders refresh by
// re-acquiring. A lease older than its TTL is taken over. Falls back to
// the memory lock when the state dir is unavailable.

export function acquireDurableLock(op: string, ttlMs = 10 * 60_000, now = Date.now()): boolean {
  const dir = join(stateDir(), 'setup-locks');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return tryAcquireSetupLock(op);
  }
  const file = join(dir, `${op}.lock`);
  const fresh = (at: number) => now - at <= ttlMs;
  try {
    const raw = readFileSync(file, 'utf-8');
    try {
      const lease = JSON.parse(raw) as { acquiredAt?: number };
      if (typeof lease.acquiredAt === 'number' && fresh(lease.acquiredAt)) return false;
    } catch {
      return false; // unparseable lease: held conservatively
    }
  } catch {
    // no lease file: free
  }
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ acquiredAt: now, pid: process.pid }), 'utf-8');
    try {
      // If a fresh lease appeared between read and write, back off.
      const raw = readFileSync(file, 'utf-8');
      try {
        const lease = JSON.parse(raw) as { acquiredAt?: number };
        if (typeof lease.acquiredAt === 'number' && fresh(lease.acquiredAt)) {
          unlinkSync(tmp);
          return false;
        }
      } catch {
        unlinkSync(tmp);
        return false;
      }
    } catch {
      // still absent: claim it
    }
    renameSync(tmp, file);
    return true;
  } catch {
    return tryAcquireSetupLock(op);
  }
}

export function releaseDurableLock(op: string): void {
  const file = join(stateDir(), 'setup-locks', `${op}.lock`);
  try {
    unlinkSync(file);
  } catch {
    // already gone
  }
  releaseSetupLock(op);
}
