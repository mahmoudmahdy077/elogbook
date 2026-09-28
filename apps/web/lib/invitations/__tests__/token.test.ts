import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  INVITATION_TTL_HOURS,
  buildInvitationAcceptUrl,
  classifyInvitation,
  hashInvitationToken,
  invitationExpiresAt,
  isValidInvitationTokenFormat,
} from '../token';

const NOW = new Date('2026-09-28T12:00:00.000Z');

function pendingInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    tenant_id: 'tenant-a',
    email: 'invitee@example.test',
    role: 'supervisor',
    status: 'pending',
    expires_at: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

describe('invitation token hashing', () => {
  it('stores a sha256 digest rather than the token', () => {
    const digest = hashInvitationToken('a'.repeat(43));

    expect(digest).toBe(createHash('sha256').update('a'.repeat(43)).digest('hex'));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different digest for a different token', () => {
    expect(hashInvitationToken('token-one')).not.toBe(hashInvitationToken('token-two'));
  });

  it('is deterministic so a lookup by digest is possible', () => {
    expect(hashInvitationToken('repeatable')).toBe(hashInvitationToken('repeatable'));
  });
});

describe('invitation expiry', () => {
  it('expires a bounded number of hours after issue', () => {
    expect(invitationExpiresAt(NOW).toISOString()).toBe(
      new Date(NOW.getTime() + INVITATION_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    );
  });

  it('reports a pending invitation inside its window as valid', () => {
    expect(classifyInvitation(pendingInvite(), NOW).state).toBe('valid');
  });

  it('reports a pending invitation past expires_at as expired', () => {
    const expired = pendingInvite({ expires_at: '2026-09-28T11:59:59.000Z' });

    expect(classifyInvitation(expired, NOW).state).toBe('expired');
  });

  it('treats the exact expiry instant as expired', () => {
    const boundary = pendingInvite({ expires_at: NOW.toISOString() });

    expect(classifyInvitation(boundary, NOW).state).toBe('expired');
  });

  it('honours an explicit terminal expired status', () => {
    expect(classifyInvitation(pendingInvite({ status: 'expired' }), NOW).state).toBe('expired');
  });
});

describe('invitation single use', () => {
  it('reports an accepted invitation as used', () => {
    expect(classifyInvitation(pendingInvite({ status: 'accepted' }), NOW).state).toBe('used');
  });

  it('keeps reporting a used invitation as used after its expiry', () => {
    const used = pendingInvite({ status: 'accepted', expires_at: '2026-09-28T11:00:00.000Z' });

    expect(classifyInvitation(used, NOW).state).toBe('used');
  });
});

describe('invitation lookup misses', () => {
  it('reports a missing row as unknown', () => {
    expect(classifyInvitation(null, NOW).state).toBe('unknown');
  });

  it('never leaks tenant or email detail alongside the state', () => {
    const result = classifyInvitation(pendingInvite(), NOW);

    expect(Object.keys(result).sort()).toEqual(['state']);
  });
});

describe('invitation accept link', () => {
  it('builds a same-origin signup link carrying the token', () => {
    expect(buildInvitationAcceptUrl('https://app.example.test', 'tok-abc')).toBe(
      'https://app.example.test/signup?invitation=tok-abc',
    );
  });

  it('rejects a plaintext origin so the token is never sent in clear', () => {
    expect(() => buildInvitationAcceptUrl('http://app.example.test', 'tok-abc')).toThrow(
      /https/i,
    );
  });

  it('allows a loopback origin for local development', () => {
    expect(buildInvitationAcceptUrl('http://localhost:3000', 'tok-abc')).toContain('/signup?invitation=tok-abc');
  });

  it('tolerates a trailing slash on the configured origin', () => {
    expect(buildInvitationAcceptUrl('https://app.example.test/', 'tok-abc')).toBe(
      'https://app.example.test/signup?invitation=tok-abc',
    );
  });

  it('rejects an origin that is not a valid absolute URL', () => {
    expect(() => buildInvitationAcceptUrl('not-a-url', 'tok-abc')).toThrow();
  });
});

describe('invitation token format', () => {
  it('accepts a base64url token of the issued length', () => {
    expect(isValidInvitationTokenFormat('A'.repeat(43))).toBe(true);
  });

  it('rejects a token that is too short to be unguessable', () => {
    expect(isValidInvitationTokenFormat('short')).toBe(false);
  });

  it('rejects a token containing characters outside base64url', () => {
    expect(isValidInvitationTokenFormat(`${'A'.repeat(42)}+`)).toBe(false);
  });

  it('rejects a non-string token', () => {
    expect(isValidInvitationTokenFormat(undefined as unknown as string)).toBe(false);
  });
});
