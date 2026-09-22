// packages/shared/src/email/resend.ts
export async function resendSend(apiKey: string, from: string, msg: { to: string; subject: string; html: string; text?: string; headers?: Record<string, string> }): Promise<{ id: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers }),
  });
  if (!res.ok) {
    const err = new Error(`resend: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}
