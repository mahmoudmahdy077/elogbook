import type { OutboundMessage } from './types';

type Sender = (msg: OutboundMessage) => Promise<{ id: string }>;

/**
 * A send whose outcome is unknown. The provider may have accepted the message
 * and lost the response; the recipient may or may not have it.
 */
export class AmbiguousDeliveryError extends Error {
  readonly status: number;
  readonly code = 'ambiguous';
  readonly retryable = false;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'AmbiguousDeliveryError';
    this.status = status;
  }
}

export class EmailTransportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'EmailTransportError';
    this.status = status;
    this.code = code;
  }
}

/**
 * A failure that may or may not have delivered the message.
 *
 * Failover to a second provider is only safe when the primary's failure is
 * proof of NON-delivery. That is true for a client rejection (the provider read
 * the request and refused it) and false for everything that looks like a lost
 * response: a transport error, a timeout, a 5xx the provider produced after
 * possibly having queued the send.
 *
 * Failing over on an ambiguous failure means a resident receives two copies of a
 * clinical notification from two different senders, with no record connecting
 * them -- and because the first send may have succeeded, the retry is not
 * idempotent at the recipient even though it is at the provider. So an
 * ambiguous failure is reported as such and the queue reconciles it against the
 * provider's own delivery record instead of sending again.
 *
 * Transports that can prove non-delivery say so with `definitive: true`. The
 * default is ambiguous, because the safe answer to "did it send?" is "unknown"
 * and the unsafe one is "no".
 */
export function isAmbiguousProviderFailure(error: unknown): boolean {
  const candidate = error as { status?: unknown; definitive?: unknown; message?: unknown } | null;
  if (!candidate || typeof candidate !== 'object') return true;

  const status = typeof candidate.status === 'number' ? candidate.status : 500;
  if (status >= 400 && status < 500) return false;
  if (candidate.definitive === true) return false;

  // Named timeouts stay ambiguous even when they carry a 5xx status: a gateway
  // timeout is by definition a response that was never produced.
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  if (/timeout|timed out|etimedout|abort|econn|reset|socket|network/.test(message)) return true;

  return true;
}

export async function sendWithFailover(
  msg: OutboundMessage,
  transports: { resend: Sender; smtp: Sender },
): Promise<{ id: string; via: 'resend' | 'smtp' }> {
  try {
    const r = await transports.resend(msg);
    return { id: r.id, via: 'resend' };
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (status >= 400 && status < 500) throw e;
    if (isAmbiguousProviderFailure(e)) {
      // Surface the ambiguity instead of guessing. The caller reconciles
      // against the provider before the queue row is retried.
      const detail = e instanceof Error ? e.message : 'unknown provider failure';
      throw new AmbiguousDeliveryError(status, detail);
    }
    const s = await transports.smtp(msg);
    return { id: s.id, via: 'smtp' };
  }
}
