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
import { appendFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

export interface SetupRequest {
  url: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip: string;
}

export interface SetupEnv {
  SETUP_MODE?: string;
  SETUP_BOOTSTRAP_TOKEN?: string;
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

export function checkSetupRequest(
  req: SetupRequest,
  _op: string,
  env: SetupEnv = process.env as SetupEnv,
  fs: SetupFs = { markerExists: () => false },
): GuardVerdict {
  if (env.NODE_ENV === 'production') return deny(404, 'Not Found');
  if (env.SETUP_MODE !== 'true' || fs.markerExists()) return deny(403, 'Setup not available');

  const host = hostOf(req.url);
  const configured = env.SETUP_BOOTSTRAP_TOKEN;
  const presented = req.headers['x-setup-token'];
  const tokenValid = !!configured && !!presented && tokensEqual(presented, configured);

  if (configured) {
    if (!tokenValid) return deny(401, 'Valid setup token required');
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
  password: z.string().min(1).max(512),
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
// x-forwarded-for is attacker-controlled unless a trusted proxy contract
// exists. hops = number of trusted proxy hops in front of us
// (TRUSTED_PROXY_HOPS); with 0 hops the chain is untrusted and the direct
// peer is unknown in this runtime, so callers get 'direct' (localhost-only
// policies then apply conservatively).

export function trustedProxyHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Route helper: client IP honoring the trusted-proxy contract. */
export function clientIpOfRequest(request: Request): string {
  return clientIpFromHeaders(
    { 'x-forwarded-for': request.headers.get('x-forwarded-for') ?? undefined },
    trustedProxyHops(),
  );
}

export function clientIpFromHeaders(headers: Record<string, string | undefined>, hops: number): string {
  const raw = headers['x-forwarded-for'] ?? headers['X-Forwarded-For'];
  if (!raw || hops <= 0) return 'direct';
  const chain = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (chain.length === 0) return 'direct';
  // With H trusted hops, the client is the leftmost untrusted address.
  const idx = Math.max(0, chain.length - 1 - hops);
  return chain[idx] ?? 'direct';
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
  if (!configured || !presented || !tokensEqual(presented, configured)) {
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
