// packages/shared/src/email/send.ts
import type { OutboundMessage } from './types';
type Sender = (msg: OutboundMessage) => Promise<{ id: string }>;
export async function sendWithFailover(msg: OutboundMessage, transports: { resend: Sender; smtp: Sender }): Promise<{ id: string; via: 'resend' | 'smtp' }> {
  try {
    const r = await transports.resend(msg);
    return { id: r.id, via: 'resend' };
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (status >= 400 && status < 500) throw e;
    const s = await transports.smtp(msg);
    return { id: s.id, via: 'smtp' };
  }
}
