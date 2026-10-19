export type NormalizedEmailWebhookType =
  | 'accepted'
  | 'delivered'
  | 'hard_bounced'
  | 'complained'
  | 'unsubscribed';

export type ParsedEmailWebhookEvent = {
  type: NormalizedEmailWebhookType;
  providerMessageId: string;
  recipients: string[];
  occurredAt: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_RECIPIENTS = 100;

export function normalizeEmailWebhookType(value: string): NormalizedEmailWebhookType | null {
  if (value === 'email.sent') return 'accepted';
  if (value === 'email.delivered') return 'delivered';
  if (value === 'email.bounced') return 'hard_bounced';
  if (value === 'email.complained') return 'complained';
  if (value === 'email.unsubscribed') return 'unsubscribed';
  return null;
}

export function svixTimestampIsFresh(
  timestamp: string,
  nowMs = Date.now(),
  toleranceMs = 5 * 60 * 1000,
): boolean {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds)
    && Number.isInteger(seconds)
    && seconds >= 0
    && Math.abs(nowMs - seconds * 1000) <= toleranceMs;
}

export function parseEmailWebhookEvent(
  raw: string,
): ParsedEmailWebhookEvent | { ok: false; code: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'invalid_event' };
  }
  const event = parsed as Record<string, unknown>;
  if (typeof event.type !== 'string') return { ok: false, code: 'invalid_event' };
  const type = normalizeEmailWebhookType(event.type);
  if (!type) return { ok: false, code: 'unsupported_event' };

  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: 'invalid_event' };
  }
  const values = data as Record<string, unknown>;
  if (!Array.isArray(values.to) || values.to.length === 0) {
    return { ok: false, code: 'invalid_recipient' };
  }
  if (values.to.length > MAX_RECIPIENTS) return { ok: false, code: 'too_many_recipients' };
  const recipients: string[] = [];
  for (const value of values.to) {
    if (typeof value !== 'string') return { ok: false, code: 'invalid_recipient' };
    const recipient = value.trim().toLowerCase();
    if (recipient.length > 320 || !EMAIL_PATTERN.test(recipient)) {
      return { ok: false, code: 'invalid_recipient' };
    }
    if (!recipients.includes(recipient)) recipients.push(recipient);
  }

  const providerMessageId = typeof values.email_id === 'string' ? values.email_id.trim() : '';
  if (!PROVIDER_ID_PATTERN.test(providerMessageId)) {
    return { ok: false, code: 'invalid_provider_message_id' };
  }
  if (typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at))) {
    return { ok: false, code: 'invalid_event' };
  }

  return {
    type,
    providerMessageId,
    recipients,
    occurredAt: new Date(event.created_at).toISOString(),
  };
}
