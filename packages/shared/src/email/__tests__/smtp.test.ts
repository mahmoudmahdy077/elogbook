import { describe, expect, it, vi, beforeEach } from 'vitest';

// nodemailer is mocked so the assertions are about what this transport asks the
// server to do, not about SMTP itself.

const sendMail = vi.hoisted(() => vi.fn());
const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail: sendMail })));

vi.mock('nodemailer', () => ({ default: { createTransport } }));

import { smtpSend, smtpIdempotencyMessageId } from '../smtp';

const CFG = { host: 'smtp.example.test', port: 587, user: 'u', pass: 'p', from: 'no-reply@example.test' };

beforeEach(() => {
  sendMail.mockReset();
  createTransport.mockClear();
  sendMail.mockResolvedValue({ messageId: '<server-side@example.test>' });
});

describe('smtpSend idempotency', () => {
  it('derives a stable Message-ID from the queue row so a retry is the same message', async () => {
    await smtpSend(CFG, { to: 'a@example.test', subject: 's', html: 'h', idempotencyKey: 'queue-row-42' });
    const [options] = sendMail.mock.calls[0] as [{ headers: Record<string, string> }];
    const first = options.headers['Message-ID'];

    sendMail.mockClear();
    await smtpSend(CFG, { to: 'a@example.test', subject: 's', html: 'h', idempotencyKey: 'queue-row-42' });
    const [retry] = sendMail.mock.calls[0] as [{ headers: Record<string, string> }];

    // Same logical message, same Message-ID: a receiving MTA that already has it
    // can deduplicate, and an operator reconciling two sends can match them.
    expect(first).toBe(retry.headers['Message-ID']);
    expect(first).toBe(smtpIdempotencyMessageId('queue-row-42', 'a@example.test', CFG.from));
  });

  it('produces a syntactically valid Message-ID', () => {
    const id = smtpIdempotencyMessageId('queue-row-42', 'a@example.test', CFG.from);
    expect(id).toMatch(/^<[A-Za-z0-9._-]+@[A-Za-z0-9.-]+>$/);
  });

  it('stamps the configured sending domain, never the recipient\'s', () => {
    // The Message-ID is a header the sending host, the receiving host and any
    // log in between all see. Deriving its domain from the recipient publishes
    // the recipient's mail domain, and for tenant mail that is the recipient
    // organisation. The configured From address is the domain this host
    // actually sends for, so the ID belongs to it.
    const id = smtpIdempotencyMessageId('queue-row-42', 'clinician@partner-hospital.test', CFG.from);
    expect(id).toMatch(/@example\.test>$/);
    expect(id).not.toContain('partner-hospital');
  });

  it('keeps the recipient in the digest so two rows to one person do not collide', () => {
    const send = smtpIdempotencyMessageId('row-1', 'a@partner-hospital.test', CFG.from);
    expect(send).toBe(smtpIdempotencyMessageId('row-1', 'a@partner-hospital.test', CFG.from));
    expect(send).not.toBe(smtpIdempotencyMessageId('row-1', 'b@partner-hospital.test', CFG.from));
    expect(send).not.toBe(smtpIdempotencyMessageId('row-2', 'a@partner-hospital.test', CFG.from));
  });

  it('sends a Message-ID that carries the sending domain to the wire', async () => {
    await smtpSend(CFG, {
      to: 'clinician@partner-hospital.test',
      subject: 's',
      html: 'h',
      idempotencyKey: 'queue-row-42',
    });
    const [options] = sendMail.mock.calls[0] as [{ headers: Record<string, string> }];
    expect(options.headers['Message-ID']).toBe(
      smtpIdempotencyMessageId('queue-row-42', 'clinician@partner-hospital.test', CFG.from),
    );
    expect(options.headers['Message-ID']).not.toContain('partner-hospital');
  });

  it('falls back to a neutral domain rather than the recipient when From is unusable', () => {
    const id = smtpIdempotencyMessageId('queue-row-42', 'clinician@partner-hospital.test', 'not-an-address');
    expect(id).toMatch(/^<[A-Za-z0-9._-]+@localhost>$/);
    expect(id).not.toContain('partner-hospital');
  });

  it('gives different queue rows different Message-IDs', () => {
    expect(smtpIdempotencyMessageId('row-1', 'a@example.test', CFG.from))
      .not.toBe(smtpIdempotencyMessageId('row-2', 'a@example.test', CFG.from));
  });

  it('omits Message-ID when there is no key, leaving the server to choose', async () => {
    await smtpSend(CFG, { to: 'a@example.test', subject: 's', html: 'h' });
    const [options] = sendMail.mock.calls[0] as [{ headers?: Record<string, string> }];
    expect(options.headers?.['Message-ID']).toBeUndefined();
  });

  it('reports a transport failure as ambiguous rather than clean', async () => {
    sendMail.mockRejectedValue(new Error('ECONNRESET'));
    await expect(smtpSend(CFG, { to: 'a@example.test', subject: 's', html: 'h' })).rejects.toMatchObject({
      code: 'smtp_transport_error',
      definitive: false,
    });
  });
});
