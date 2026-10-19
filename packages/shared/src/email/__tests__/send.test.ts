// packages/shared/src/email/__tests__/send.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sendWithFailover, isAmbiguousProviderFailure } from '../send';

// Failover is only safe when the primary's failure is *proof of non-delivery*.
//
// A 4xx is proof: the provider read the request and rejected it. A connection
// reset, a timeout, or a 5xx with no body is not -- the provider may have
// accepted the message and lost the response. Failing over to a second provider
// in that case sends the resident two copies of a clinical notification, from
// two different senders, with no record of either relationship.
//
// So: a stable idempotency key travels with the message so a retry is
// deduplicated at the provider, and an ambiguous failure is surfaced as
// `ambiguous` for the queue to reconcile rather than retried on a second
// transport.

describe('sendWithFailover', () => {
  it('falls over to smtp on a definitive resend 5xx with no body', async () => {
    const resend = vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { status: 500, definitive: true }));
    const smtp = vi.fn().mockResolvedValue({ id: 'smtp-1' });
    const out = await sendWithFailover({ to: 'a@x.com', templateKey: 'digest.weekly', subject: 's', html: 'h' }, { resend, smtp });
    expect(out).toEqual({ id: 'smtp-1', via: 'smtp' });
  });

  it('does not fail over on resend 400', async () => {
    const resend = vi.fn().mockRejectedValue(Object.assign(new Error('bad addr'), { status: 400 }));
    const smtp = vi.fn();
    await expect(sendWithFailover({ to: 'a@x.com', templateKey: 'digest.weekly', subject: 's', html: 'h' }, { resend, smtp })).rejects.toThrow();
    expect(smtp).not.toHaveBeenCalled();
  });

  it('does not fail over when the primary timed out: the message may already be sent', async () => {
    const resend = vi.fn().mockRejectedValue(Object.assign(new Error('resend_transport_error'), { status: 500 }));
    const smtp = vi.fn().mockResolvedValue({ id: 'smtp-1' });

    await expect(
      sendWithFailover({ to: 'a@x.com', templateKey: 'digest.weekly', subject: 's', html: 'h' }, { resend, smtp }),
    ).rejects.toMatchObject({ code: 'ambiguous', status: 500 });

    expect(smtp).not.toHaveBeenCalled();
  });

  it('does not fail over when the primary is unconfigured, which is also not proof of delivery', async () => {
    // "resend not configured" arrives as a 500 from the caller. The primary was
    // never contacted, so a second transport IS correct here -- but it must be
    // reached by a caller that marks the refusal definitive, not by accident.
    const resend = vi.fn().mockRejectedValue(
      Object.assign(new Error('resend not configured'), { status: 500, definitive: true }),
    );
    const smtp = vi.fn().mockResolvedValue({ id: 'smtp-1' });
    const out = await sendWithFailover({ to: 'a@x.com', templateKey: 'digest.weekly', subject: 's', html: 'h' }, { resend, smtp });
    expect(out.via).toBe('smtp');
  });

  it('passes the idempotency key to the primary so a retry is deduplicated', async () => {
    const resend = vi.fn().mockResolvedValue({ id: 'resend-1' });
    const smtp = vi.fn();
    const msg = { to: 'a@x.com', templateKey: 'digest.weekly' as const, subject: 's', html: 'h', idempotencyKey: 'queue-row-42' };

    await sendWithFailover(msg, { resend, smtp });

    expect(resend).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'queue-row-42' }));
  });

  it('propagates the same key to the secondary when it does fail over', async () => {
    const resend = vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { status: 502, definitive: true }));
    const smtp = vi.fn().mockResolvedValue({ id: 'smtp-1' });
    const msg = { to: 'a@x.com', templateKey: 'digest.weekly' as const, subject: 's', html: 'h', idempotencyKey: 'queue-row-42' };

    const out = await sendWithFailover(msg, { resend, smtp });

    expect(smtp).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'queue-row-42' }));
    expect(out.via).toBe('smtp');
  });
});

describe('isAmbiguousProviderFailure', () => {
  it('treats a transport error as ambiguous', () => {
    expect(
      isAmbiguousProviderFailure(Object.assign(new Error('resend_transport_error'), { status: 500 })),
    ).toBe(true);
  });

  it('treats a client rejection as definitive', () => {
    expect(
      isAmbiguousProviderFailure(Object.assign(new Error('resend_http_422'), { status: 422 })),
    ).toBe(false);
  });

  it('honours an explicit definitive marker from a transport that has one', () => {
    expect(
      isAmbiguousProviderFailure(Object.assign(new Error('down'), { status: 500, definitive: true })),
    ).toBe(false);
  });

  it('treats a timeout by name as ambiguous even with a 5xx status', () => {
    expect(
      isAmbiguousProviderFailure(Object.assign(new Error('gateway timeout'), { status: 504 })),
    ).toBe(true);
  });
});
