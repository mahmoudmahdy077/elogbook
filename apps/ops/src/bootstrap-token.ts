/**
 * Bootstrap ownership claim (T09).
 *
 * One documented host step (verified launcher / cloud-init) prints a
 * single-use token to the VPS owner. Claiming binds one setup session to
 * the installation ID. Security properties, all covered by unit tests:
 *
 * - 256-bit entropy per token; only the SHA-256 verifier is stored.
 * - Single-use: a verified claim can never verify again (replay fails).
 * - Expiry (default 30 min), installation binding, wrong-token rejection.
 * - Attempt throttling: MAX_CLAIM_ATTEMPTS wrong tries lock the claim;
 *   lockout is part of the record so restarts cannot clear it (once the
 *   T10 journal persists records; the memory store below is process-local
 *   and documented as such).
 * - Constant-time verifier comparison (timingSafeEqual).
 * - Reasons are server-side only; the claimant always gets a generic
 *   message (see verifyClaim docs) to avoid claim oracles.
 *
 * Out of scope here (T10): HTTP transport, SQLite journal persistence,
 * session issuance, concurrent-claim fencing across processes.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32;
export const TOKEN_TTL_MS = 30 * 60 * 1000;
export const MAX_CLAIM_ATTEMPTS = 5;
export const CLAIM_LOCK_MS = 15 * 60 * 1000;

export interface BootstrapClaimRecord {
  installationId: string;
  /** Hex SHA-256 of the token. The token itself is never stored. */
  verifier: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  attempts: number;
  lockedUntil: number | null;
}

export type ClaimFailureReason = 'unknown' | 'expired' | 'used' | 'locked' | 'invalid';

export type ClaimResult = { ok: true } | { ok: false; reason: ClaimFailureReason };

export function generateBootstrapToken(): { token: string; verifier: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const verifier = createHash('sha256').update(token, 'utf-8').digest('hex');
  return { token, verifier };
}

export function createClaim(args: {
  installationId: string;
  verifier: string;
  now?: number;
  ttlMs?: number;
}): BootstrapClaimRecord {
  const now = args.now ?? Date.now();
  const ttl = args.ttlMs ?? TOKEN_TTL_MS;
  if (!args.installationId) throw new Error('installationId is required');
  if (!/^[0-9a-f]{64}$/.test(args.verifier)) throw new Error('verifier must be hex sha256');
  return {
    installationId: args.installationId,
    verifier: args.verifier,
    createdAt: now,
    expiresAt: now + ttl,
    usedAt: null,
    attempts: 0,
    lockedUntil: null,
  };
}

function verifierMatches(record: BootstrapClaimRecord, presentedToken: string): boolean {
  const presented = createHash('sha256').update(presentedToken, 'utf-8').digest();
  const expected = Buffer.from(record.verifier, 'hex');
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

export interface ClaimStore {
  load(installationId: string): BootstrapClaimRecord | null;
  save(record: BootstrapClaimRecord): void;
}

/** Process-local store for tests/dev. Production persistence is T10's journal. */
export function createMemoryClaimStore(): ClaimStore {
  const records = new Map<string, BootstrapClaimRecord>();
  return {
    load: (installationId) => records.get(installationId) ?? null,
    save: (record) => {
      records.set(record.installationId, { ...record });
    },
  };
}

/**
 * Verify a claim. Mutates attempt/lock/used state via the store on every
 * evaluated path (including failures) so retries cannot bypass throttling.
 * Callers MUST NOT forward `reason` to untrusted claimants; log it
 * server-side and return a generic denial instead.
 */
export function verifyClaim(
  store: ClaimStore,
  args: { installationId: string; token: string; now?: number },
): ClaimResult {
  const now = args.now ?? Date.now();
  const record = store.load(args.installationId);
  // Keyed store: a claim for any other installation simply has no record.
  if (!record) return { ok: false, reason: 'unknown' };
  if (record.lockedUntil !== null && now < record.lockedUntil) {
    return { ok: false, reason: 'locked' };
  }
  if (record.usedAt !== null) return { ok: false, reason: 'used' };
  if (now > record.expiresAt) return { ok: false, reason: 'expired' };
  if (!verifierMatches(record, args.token)) {
    record.attempts += 1;
    if (record.attempts >= MAX_CLAIM_ATTEMPTS) {
      record.lockedUntil = now + CLAIM_LOCK_MS;
    }
    store.save(record);
    return { ok: false, reason: record.lockedUntil !== null && now < record.lockedUntil ? 'locked' : 'invalid' };
  }
  record.usedAt = now;
  store.save(record);
  return { ok: true };
}
