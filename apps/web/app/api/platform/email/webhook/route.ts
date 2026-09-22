// apps/web/app/api/platform/email/webhook/route.ts
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function hmacKey(secret: string): string | Buffer {
  // Svix secrets are `whsec_<base64>`; use the decoded bytes when present.
  // Plain secrets (tests / simple Resend HMAC) are used as-is.
  if (secret.startsWith('whsec_')) {
    const raw = secret.slice('whsec_'.length);
    try {
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length > 0) return decoded;
    } catch {
      // fall through to raw secret
    }
  }
  return secret;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function verifySvix(rawBody: string, timestamp: string, sigHeader: string, secret: string): boolean {
  const key = hmacKey(secret);
  const signed = `${timestamp}.${rawBody}`;
  const expectedHex = createHmac('sha256', key).update(signed).digest('hex');
  const expectedB64 = createHmac('sha256', key).update(signed).digest('base64');
  // Svix sends space-separated `v1,<sig>` entries; accept any valid v1 entry.
  const candidates = sigHeader
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => s.split(',').map((p) => p.trim()))
    .filter(Boolean);
  // Extract sigs after `v1` markers; also tolerate bare sig values.
  const sigs: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] === 'v1' && i + 1 < candidates.length) {
      sigs.push(candidates[i + 1]);
      i++;
    } else if (candidates[i].startsWith('v1,')) {
      sigs.push(candidates[i].slice(3));
    } else if (!candidates[i].startsWith('v')) {
      sigs.push(candidates[i]);
    }
  }
  // Fallback: header may be exactly `v1,<sig>`.
  if (sigs.length === 0 && sigHeader.includes('v1,')) {
    for (const part of sigHeader.split(' ')) {
      const idx = part.indexOf('v1,');
      if (idx >= 0) sigs.push(part.slice(idx + 3).split(',')[0].trim());
    }
  }
  return sigs.some((sig) => safeEqual(sig, expectedHex) || safeEqual(sig, expectedB64));
}

function verifyResendSimple(rawBody: string, sigHeader: string, secret: string): boolean {
  const key = hmacKey(secret);
  const expectedHex = createHmac('sha256', key).update(rawBody).digest('hex');
  const expectedB64 = createHmac('sha256', key).update(rawBody).digest('base64');
  const presented = sigHeader.trim();
  return safeEqual(presented, expectedHex) || safeEqual(presented, expectedB64);
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }
  const svixSig = request.headers.get('svix-signature');
  const svixTs = request.headers.get('svix-timestamp');
  const resendSig = request.headers.get('resend-signature');
  if (!svixSig && !resendSig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }
  const rawBody = await request.text();
  let verified = false;
  if (svixSig) {
    if (!svixTs) {
      return NextResponse.json({ error: 'Missing timestamp' }, { status: 401 });
    }
    verified = verifySvix(rawBody, svixTs, svixSig, secret);
  }
  if (!verified && resendSig) {
    verified = verifyResendSimple(rawBody, resendSig, secret);
  }
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  let body: { type?: string; data?: { to?: string[] } };
  try {
    body = JSON.parse(rawBody) as { type?: string; data?: { to?: string[] } };
  } catch {
    return NextResponse.json({ error: 'Bad event' }, { status: 400 });
  }
  const to = body.data?.to?.[0]?.toLowerCase();
  if (!to) return NextResponse.json({ error: 'Bad event' }, { status: 400 });
  const reason = body.type === 'email.complained' ? 'complaint' : body.type === 'email.unsubscribed' ? 'unsubscribe' : 'bounce';
  await createServiceRoleClient().from('email_suppressions').upsert({ email: to, reason }, { onConflict: 'email' });
  return NextResponse.json({ success: true });
}
