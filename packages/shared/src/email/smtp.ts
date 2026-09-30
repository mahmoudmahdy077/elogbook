import { createHash, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { EmailTransportError } from './send';

export interface SmtpConfig { host: string; port: number; user: string; pass: string; from: string }

/**
 * A deterministic RFC 5322 Message-ID for a logical message.
 *
 * SMTP has no idempotency key, so the closest equivalent is the Message-ID the
 * sending MTA stamps. Deriving it from the queue row (plus the recipient, so two
 * rows to the same person do not collide) means a retry presents the same ID: a
 * receiving server that already has the message can deduplicate it, and an
 * operator reconciling an ambiguous send can match the two attempts.
 *
 * The hash is used rather than the raw key so the header cannot carry a value
 * another system might interpret.
 *
 * The domain is the CONFIGURED From address, never the recipient's. A
 * Message-ID is a header that the sending host, the receiving host and every
 * log in between see, so a recipient-derived domain publishes the recipient's
 * mail domain -- for tenant mail, the recipient organisation -- to all of them.
 * The From address is the domain this host actually sends for, which is what
 * makes the ID syntactically valid for it in the first place. A From with no
 * usable domain falls back to `localhost` rather than to the recipient: a wrong
 * domain is recoverable, a disclosed one is not.
 */
export function smtpIdempotencyMessageId(idempotencyKey: string, recipient: string, from: string): string {
  const digest = createHash('sha256')
    .update(`${idempotencyKey}\u0000${recipient.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
  const domain = (from.split('@')[1] ?? '').replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
  return `<${digest}@${domain}>`;
}

export async function smtpSend(cfg: SmtpConfig, msg: { to: string; subject: string; html: string; text?: string; headers?: Record<string, string>; idempotencyKey?: string }): Promise<{ id: string }> {
  const messageId =
    typeof msg.idempotencyKey === 'string' && msg.idempotencyKey.length > 0 && msg.idempotencyKey.length <= 128
      ? smtpIdempotencyMessageId(msg.idempotencyKey, msg.to, cfg.from)
      : undefined;

  const headers: Record<string, string> = { ...(msg.headers ?? {}) };
  if (messageId) headers['Message-ID'] = messageId;

  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      requireTLS: cfg.port !== 465,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const info = await transport.sendMail({ from: cfg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers });
    const id = typeof info.messageId === 'string' && info.messageId.length > 0 ? info.messageId : (messageId ?? `smtp-${randomUUID()}`);
    return { id };
  } catch {
    // Ambiguous: the DATA command may have been accepted before the connection
    // failed, so this is not proof of non-delivery and must not trigger a
    // second transport.
    throw Object.assign(new EmailTransportError(500, 'smtp_transport_error'), { definitive: false });
  }
}
