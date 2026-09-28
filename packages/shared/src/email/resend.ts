import { EmailTransportError } from './send';

export async function resendSend(apiKey: string, from: string, msg: { to: string; subject: string; html: string; text?: string; headers?: Record<string, string> }): Promise<{ id: string }> {
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EmailTransportError(500, 'resend_transport_error');
  }
  if (!response.ok) {
    throw new EmailTransportError(response.status, `resend_http_${response.status}`);
  }
  try {
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(body.id)) {
      throw new EmailTransportError(502, 'resend_invalid_response');
    }
    return { id: body.id };
  } catch (error) {
    if (error instanceof EmailTransportError) throw error;
    throw new EmailTransportError(502, 'resend_invalid_response');
  }
}
