import { describe, expect, it } from 'vitest';
import {
  buildListUnsubscribeHeaders,
  createUnsubscribeToken,
  validateEmailQueuePayload,
  verifyUnsubscribeToken,
} from '../safety';

const secret = 'email-token-secret-with-at-least-32-bytes';
const templateKeys = [
  'invite.welcome',
  'contact.admin-alert',
  'case.pending-review',
  'case.approved',
  'case.rejected',
  'digest.weekly',
  'newsletter.generic',
  'auth.invite-fallback-note',
];

describe('email queue payload safety', () => {
  it('accepts bounded metadata-only variables', () => {
    expect(validateEmailQueuePayload({
      case_url: 'https://app.example.test/tenant/case/id',
      activity_count: '3',
    })).toEqual({ ok: true });
  });

  it.each(['message', 'body', 'body_html', 'body_text', 'summary', 'field_values', 'content'])(
    'rejects sensitive payload key %s at any depth',
    (key) => {
      const payload: Record<string, unknown> = { metadata: { [key]: 'sensitive body' } };
      expect(validateEmailQueuePayload(payload)).toEqual({ ok: false, code: 'sensitive_payload' });
    },
  );

  it('rejects unknown, non-string, and oversized payload variables', () => {
    expect(validateEmailQueuePayload({ arbitrary_note: 'value' })).toEqual({ ok: false, code: 'unknown_variable' });
    expect(validateEmailQueuePayload({ case_url: { message: 'nested' } })).toEqual({ ok: false, code: 'sensitive_payload' });
    expect(validateEmailQueuePayload({ case_url: {} })).toEqual({ ok: false, code: 'invalid_value' });
    expect(validateEmailQueuePayload({ case_url: 'x'.repeat(16_385) })).toEqual({ ok: false, code: 'payload_too_large' });
  });
});

describe('email unsubscribe headers', () => {
  it('adds RFC 8058 headers for every major template without placing an address in the URL', () => {
    for (const templateKey of templateKeys) {
      const token = createUnsubscribeToken({
        recipientHmac: 'a'.repeat(64),
        templateKey,
        tenantId: '00000000-0000-0000-0000-000000000001',
        expiresAt: 2_000_000_000,
      }, secret);
      const headers = buildListUnsubscribeHeaders({
        baseUrl: 'https://app.example.test',
        token,
      });

      expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/app\.example\.test\/api\/email\/unsubscribe\?token=v1\./);
      expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(decodeURIComponent(headers['List-Unsubscribe'])).not.toContain('@');
    }
  });

  it('rejects tampered and expired tokens', () => {
    const token = createUnsubscribeToken({
      recipientHmac: 'b'.repeat(64),
      templateKey: 'digest.weekly',
      tenantId: null,
      expiresAt: 2_000,
    }, secret);

    expect(verifyUnsubscribeToken(token, secret, 1_000)).toMatchObject({ ok: true });
    expect(verifyUnsubscribeToken(`${token}x`, secret, 1_000)).toEqual({ ok: false, code: 'invalid_token' });
    expect(verifyUnsubscribeToken(token, secret, 3_000)).toEqual({ ok: false, code: 'expired_token' });
    expect(() => createUnsubscribeToken({
      recipientHmac: 'b'.repeat(64),
      templateKey: 'digest.weekly',
      tenantId: null,
      expiresAt: 2_000_000,
    }, 'short')).toThrow();
  });
});
