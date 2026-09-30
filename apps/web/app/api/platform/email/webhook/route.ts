import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { isJsonContentType, readRequestBody } from '@/lib/http/request-guard';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import {
  parseEmailWebhookEvent,
  svixTimestampIsFresh,
} from '@elogbook/shared/email/webhook';

export const runtime = 'nodejs';

const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

function hmacKey(secret: string): string | Buffer {
  if (secret.startsWith('whsec_')) {
    try {
      const decoded = Buffer.from(secret.slice('whsec_'.length), 'base64');
      if (decoded.length > 0) return decoded;
    } catch {
      return secret;
    }
  }
  return secret;
}

function safeEqual(value: string, expected: string): boolean {
  const presented = Buffer.from(value, 'utf8');
  const target = Buffer.from(expected, 'utf8');
  return presented.length === target.length && presented.length > 0 && timingSafeEqual(presented, target);
}

function verifySvix(rawBody: string, timestamp: string, header: string, secret: string): boolean {
  const signed = `${timestamp}.${rawBody}`;
  const key = hmacKey(secret);
  const expectedHex = createHmac('sha256', key).update(signed).digest('hex');
  const expectedBase64 = createHmac('sha256', key).update(signed).digest('base64');
  return [...header.matchAll(/v1,([A-Za-z0-9+/=_-]+)/g)].some((match) => {
    const candidate = match[1];
    return safeEqual(candidate, expectedHex) || safeEqual(candidate, expectedBase64);
  });
}

function verifyResend(rawBody: string, header: string, secret: string): boolean {
  const key = hmacKey(secret);
  const expectedHex = createHmac('sha256', key).update(rawBody).digest('hex');
  const expectedBase64 = createHmac('sha256', key).update(rawBody).digest('base64');
  return safeEqual(header.trim(), expectedHex) || safeEqual(header.trim(), expectedBase64);
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`email-webhook:${ip}`, 120);
  if (!allowed) return rateLimitResponse(retryAfter);

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const lookupSecret = process.env.EMAIL_LOOKUP_HMAC_KEY;
  if (!secret || secret.length < 32 || !lookupSecret || lookupSecret.length < 32) {
    return NextResponse.json({ error: 'Webhook verification unavailable' }, { status: 503 });
  }
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 415 });
  }

  const bodyRead = await readRequestBody(request, MAX_WEBHOOK_BODY_BYTES);
  if (!bodyRead.ok) return bodyRead.response;
  const rawBody = bodyRead.text;

  const svixSignature = request.headers.get('svix-signature');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const resendSignature = request.headers.get('resend-signature');
  const providerEventId = request.headers.get('svix-id') ?? request.headers.get('resend-event-id') ?? '';
  if (!EVENT_ID_PATTERN.test(providerEventId)) {
    return NextResponse.json({ error: 'Missing or invalid event id' }, { status: 401 });
  }

  let verified = false;
  if (svixSignature) {
    if (!svixTimestamp || !svixTimestampIsFresh(svixTimestamp)) {
      return NextResponse.json({ error: 'Stale webhook timestamp' }, { status: 401 });
    }
    verified = verifySvix(rawBody, svixTimestamp, svixSignature, secret);
  } else if (resendSignature) {
    verified = verifyResend(rawBody, resendSignature, secret);
  }
  if (!verified) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  const event = parseEmailWebhookEvent(rawBody);
  if ('ok' in event) return NextResponse.json({ error: 'Invalid webhook event' }, { status: 400 });

  const recipients = event.recipients.map((email) => ({
    email,
    recipient_hmac: createHmac('sha256', lookupSecret).update(email).digest('hex'),
  }));
  const aggregateRecipientHmac = createHmac('sha256', lookupSecret)
    .update(recipients.map(({ recipient_hmac }) => recipient_hmac).sort().join('|'))
    .digest('hex');

  const { data, error } = await createServiceRoleClient().rpc('record_email_delivery_event', {
    p_provider: 'resend',
    p_provider_event_id: providerEventId,
    p_event_type: event.type,
    p_provider_message_id: event.providerMessageId,
    p_recipient_hmac: aggregateRecipientHmac,
    p_recipients: recipients,
    p_occurred_at: event.occurredAt,
  });
  if (error) {
    if (error.code === 'P0001') return NextResponse.json({ error: 'Webhook tenant scope is ambiguous' }, { status: 409 });
    return NextResponse.json({ error: 'Webhook could not be recorded' }, { status: 500 });
  }

  const result = Array.isArray(data) ? data[0] : data;
  const replayed = result?.replayed === true;
  return NextResponse.json({ success: true, replayed });
}
