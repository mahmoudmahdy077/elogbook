import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { EmailTransportError } from './send';

export interface SmtpConfig { host: string; port: number; user: string; pass: string; from: string }
export async function smtpSend(cfg: SmtpConfig, msg: { to: string; subject: string; html: string; text?: string; headers?: Record<string, string> }): Promise<{ id: string }> {
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
    const info = await transport.sendMail({ from: cfg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
    const id = typeof info.messageId === 'string' && info.messageId.length > 0 ? info.messageId : `smtp-${randomUUID()}`;
    return { id };
  } catch {
    throw new EmailTransportError(500, 'smtp_transport_error');
  }
}
