import { EmailTransportError } from './send';

/**
 * Resend transport.
 *
 * `idempotencyKey` becomes the provider's `Idempotency-Key` header, so a retry
 * of the same queue row resolves to the same provider-side message. That is what
 * makes retrying after an ambiguous failure safe on the provider side; the
 * recipient side is why the caller still reconciles before resending.
 *
 * The key is validated here rather than trusted. It is an outbound header, and a
 * key we did not choose is a value the provider did not scope the same way we
 * scope our queue rows.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/;

export async function resendSend(
  apiKey: string,
  from: string,
  msg: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    headers?: Record<string, string>;
    idempotencyKey?: string;
  },
): Promise<{ id: string }> {
  const idempotencyKey =
    typeof msg.idempotencyKey === 'string' && IDEMPOTENCY_KEY_PATTERN.test(msg.idempotencyKey)
      ? msg.idempotencyKey
      : undefined;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Ambiguous, not clean: the request may have been accepted. `definitive` is
    // deliberately absent so failover refuses to double-send.
    throw Object.assign(new EmailTransportError(500, 'resend_transport_error'), { definitive: false });
  }
  if (!response.ok) {
    // A 4xx is the provider refusing the request: proof of non-delivery.
    // A 5xx is a response the provider may have produced after queueing the
    // send, so it stays ambiguous unless the body says otherwise.
    throw Object.assign(new EmailTransportError(response.status, `resend_http_${response.status}`), {
      definitive: response.status >= 400 && response.status < 500,
    });
  }
  try {
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(body.id)) {
      // A 2xx with an unusable body: the send may have happened, so this is
      // ambiguous rather than a clean failure.
      throw Object.assign(new EmailTransportError(502, 'resend_invalid_response'), { definitive: false });
    }
    return { id: body.id };
  } catch (error) {
    if (error instanceof EmailTransportError) throw error;
    throw Object.assign(new EmailTransportError(502, 'resend_invalid_response'), { definitive: false });
  }
}
