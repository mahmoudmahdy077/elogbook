import { describe, expect, it } from 'vitest';
import {
  normalizeEmailWebhookType,
  parseEmailWebhookEvent,
  svixTimestampIsFresh,
} from '../webhook';

describe('email webhook policy', () => {
  it('allows only explicit delivery and suppression events', () => {
    expect(normalizeEmailWebhookType('email.sent')).toBe('accepted');
    expect(normalizeEmailWebhookType('email.delivered')).toBe('delivered');
    expect(normalizeEmailWebhookType('email.bounced')).toBe('hard_bounced');
    expect(normalizeEmailWebhookType('email.complained')).toBe('complained');
    expect(normalizeEmailWebhookType('email.unsubscribed')).toBe('unsubscribed');
    expect(normalizeEmailWebhookType('email.opened')).toBeNull();
    expect(normalizeEmailWebhookType('unknown')).toBeNull();
  });

  it('rejects stale or malformed Svix timestamps', () => {
    expect(svixTimestampIsFresh('1000', 1_000_000, 300_000)).toBe(true);
    expect(svixTimestampIsFresh('1', 1_000_000, 300_000)).toBe(false);
    expect(svixTimestampIsFresh('not-a-timestamp', 1_000_000, 300_000)).toBe(false);
  });

  it('parses bounded recipients and provider message metadata without retaining raw payload', () => {
    const result = parseEmailWebhookEvent(JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-09-25T00:00:00.000Z',
      data: {
        email_id: 'provider-message-1',
        to: [' First@Example.test ', 'second@example.test'],
      },
    }));

    expect(result).toEqual({
      type: 'delivered',
      providerMessageId: 'provider-message-1',
      recipients: ['first@example.test', 'second@example.test'],
      occurredAt: '2026-09-25T00:00:00.000Z',
    });
  });

  it('rejects unknown events, invalid recipients, and oversized recipient lists', () => {
    expect(parseEmailWebhookEvent(JSON.stringify({ type: 'email.opened', data: { to: ['a@b.test'] } }))).toEqual({ ok: false, code: 'unsupported_event' });
    expect(parseEmailWebhookEvent(JSON.stringify({ type: 'email.bounced', data: { to: ['not-an-email'] } }))).toEqual({ ok: false, code: 'invalid_recipient' });
    expect(parseEmailWebhookEvent(JSON.stringify({
      type: 'email.bounced',
      data: { to: Array.from({ length: 101 }, (_, index) => `user${index}@example.test`) },
    }))).toEqual({ ok: false, code: 'too_many_recipients' });
  });
});
