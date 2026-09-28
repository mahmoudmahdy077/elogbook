import { createHash, randomBytes } from 'node:crypto';

/**
 * Invitation token boundary.
 *
 * A tenant invitation is a bearer secret, so the rule is: the raw token exists
 * only in the emailed link and in the request that redeems it. The database
 * stores a sha256 digest, the API never echoes the token, and the token binds
 * the redemption to exactly one tenant.
 *
 * Expiry is a first-class state rather than a cleanup job, so a leaked or
 * stale link is reported as dead instead of silently working.
 */

/** 32 random bytes -> 43 base64url characters. Unguessable at any realistic search budget. */
const INVITATION_TOKEN_BYTES = 32;
const BASE64URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Bounded redemption window. Long enough for an email round-trip, short enough to limit a leaked link. */
export const INVITATION_TTL_HOURS = 72;

export type InvitationState = 'valid' | 'expired' | 'used' | 'unknown';

export interface InvitationRow {
  id?: string;
  tenant_id?: string;
  email?: string;
  role?: string;
  status: string;
  expires_at: string | null;
}

export interface InvitationClassification {
  state: InvitationState;
}

export function generateInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
}

export function isValidInvitationTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && BASE64URL_TOKEN_PATTERN.test(token);
}

/** sha256 hex digest. Deterministic so redemption can look the invite up by digest. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function invitationExpiresAt(issuedAt: Date, ttlHours: number = INVITATION_TTL_HOURS): Date {
  return new Date(issuedAt.getTime() + ttlHours * 60 * 60 * 1000);
}

/**
 * The only place a raw token is turned into a link. The token goes in the
 * query string because the recipient's browser has to carry it to /signup;
 * it never goes to the database or into an API response body.
 */
export function buildInvitationAcceptUrl(origin: string, token: string): string {
  const base = new URL(origin);
  const isLoopback = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
  if (base.protocol !== 'https:' && !isLoopback) {
    throw new Error('invitation link origin must use HTTPS');
  }
  const url = new URL('/signup', base.origin);
  url.searchParams.set('invitation', token);
  return url.toString();
}

/**
 * Redacted on purpose: the caller learns only whether the invitation can still
 * be redeemed. Tenant, email and role stay server-side so a probe cannot be used
 * to enumerate which institutions exist or who works there.
 */
export function classifyInvitation(
  invite: InvitationRow | null | undefined,
  now: Date,
): InvitationClassification {
  if (!invite) return { state: 'unknown' };
  if (invite.status === 'accepted') return { state: 'used' };
  if (invite.status === 'expired') return { state: 'expired' };
  if (invite.expires_at !== null && new Date(invite.expires_at).getTime() <= now.getTime()) {
    return { state: 'expired' };
  }
  return { state: 'valid' };
}
