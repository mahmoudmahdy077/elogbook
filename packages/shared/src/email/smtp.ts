// packages/shared/src/email/smtp.ts
import nodemailer from 'nodemailer';
export interface SmtpConfig { host: string; port: number; user: string; pass: string; from: string }
export async function smtpSend(cfg: SmtpConfig, msg: { to: string; subject: string; html: string; text?: string; headers?: Record<string, string> }): Promise<{ id: string }> {
  const t = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass } });
  const info = await t.sendMail({ from: cfg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
  return { id: info.messageId ?? `smtp-${Date.now()}` };
}
