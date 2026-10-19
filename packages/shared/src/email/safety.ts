import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

const ALLOWED_PAYLOAD_KEYS = new Set([
  'activity_count',
  'case_url',
  'contact_url',
  'cta_url',
  'dashboard_url',
  'onboarding_url',
  'preheader',
  'review_url',
  'role',
]);
const FORBIDDEN_PAYLOAD_PARTS = [
  'address',
  'body',
  'clinical',
  'content',
  'diagnosis',
  'field_values',
  'html',
  'message',
  'patient',
  'summary',
  'text',
];
const MAX_PAYLOAD_BYTES = 16_384;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HMAC_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type UnsubscribeClaims = {
  recipientHmac: string;
  templateKey: string;
  tenantId: string | null;
  expiresAt: number;
};

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function containsForbiddenPayloadKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenPayloadKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = normalizedKey(key);
    return FORBIDDEN_PAYLOAD_PARTS.some((part) => normalized.includes(part)) || containsForbiddenPayloadKey(child);
  });
}

export function validateEmailQueuePayload(payload: unknown): { ok: true } | { ok: false; code: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'invalid_payload' };
  }
  if (containsForbiddenPayloadKey(payload)) return { ok: false, code: 'sensitive_payload' };
  if (Object.keys(payload as Record<string, unknown>).some((key) => !ALLOWED_PAYLOAD_KEYS.has(key))) {
    return { ok: false, code: 'unknown_variable' };
  }
  if (Object.values(payload as Record<string, unknown>).some((value) => typeof value !== 'string')) {
    return { ok: false, code: 'invalid_value' };
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
    return { ok: false, code: 'payload_too_large' };
  }
  return { ok: true };
}

function sign(value: string, secret: string): string {
  if (secret.length < 32) throw new Error('unsubscribe token secret is too short');
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function tokenBody(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function createUnsubscribeToken(input: UnsubscribeClaims, secret: string): string {
  if (!HMAC_PATTERN.test(input.recipientHmac)) throw new Error('recipient HMAC is invalid');
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(input.templateKey)) throw new Error('template key is invalid');
  if (input.tenantId !== null && !UUID_PATTERN.test(input.tenantId)) throw new Error('tenant scope is invalid');
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) throw new Error('token expiry is invalid');
  const body = tokenBody(JSON.stringify({
    h: input.recipientHmac,
    t: input.templateKey,
    n: input.tenantId,
    e: input.expiresAt,
  }));
  return `v1.${body}.${sign(`v1.${body}`, secret)}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { ok: true; claims: UnsubscribeClaims } | { ok: false; code: string } {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !BASE64URL_PATTERN.test(parts[1]) || !BASE64URL_PATTERN.test(parts[2])) {
    return { ok: false, code: 'invalid_token' };
  }
  const signed = `v1.${parts[1]}`;
  const expected = Buffer.from(sign(signed, secret));
  const presented = Buffer.from(parts[2]);
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return { ok: false, code: 'invalid_token' };
  }
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      typeof parsed.h !== 'string'
      || !HMAC_PATTERN.test(parsed.h)
      || typeof parsed.t !== 'string'
      || !/^[A-Za-z0-9_.-]{1,120}$/.test(parsed.t)
      || (parsed.n !== null && (typeof parsed.n !== 'string' || !UUID_PATTERN.test(parsed.n)))
      || !Number.isSafeInteger(parsed.e)
    ) {
      return { ok: false, code: 'invalid_token' };
    }
    if ((parsed.e as number) <= nowSeconds) return { ok: false, code: 'expired_token' };
    return {
      ok: true,
      claims: {
        recipientHmac: parsed.h,
        templateKey: parsed.t,
        tenantId: parsed.n as string | null,
        expiresAt: parsed.e as number,
      },
    };
  } catch {
    return { ok: false, code: 'invalid_token' };
  }
}

export function buildListUnsubscribeHeaders(input: { baseUrl: string; token: string }): Record<string, string> {
  const url = new URL('/api/email/unsubscribe', input.baseUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('unsubscribe URL must use HTTPS');
  }
  url.searchParams.set('token', input.token);
  return {
    'List-Unsubscribe': `<${url.toString()}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
