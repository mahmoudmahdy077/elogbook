import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { verifyUnsubscribeToken } from '@elogbook/shared/email/safety';

export const runtime = 'nodejs';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tokenFrom(request: Request): string {
  return new URL(request.url).searchParams.get('token') ?? '';
}

export async function GET(request: Request) {
  const secret = process.env.EMAIL_TOKEN_SIGNING_SECRET ?? '';
  if (secret.length < 32) return NextResponse.json({ error: 'Unsubscribe is unavailable' }, { status: 503 });
  const token = tokenFrom(request);
  const verified = verifyUnsubscribeToken(token, secret);
  if (!verified.ok) return NextResponse.json({ error: 'Invalid or expired unsubscribe link' }, { status: 400 });
  const safeToken = escapeHtml(token);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"></head><body><main><h1>Confirm unsubscribe</h1><p>This action stops future sends for this message type.</p><form method="post"><input type="hidden" name="token" value="${safeToken}"><button type="submit">Confirm unsubscribe</button></form></main></body></html>`;
  return new Response(html, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 415 });
  }
  const secret = process.env.EMAIL_TOKEN_SIGNING_SECRET ?? '';
  if (secret.length < 32) return NextResponse.json({ error: 'Unsubscribe is unavailable' }, { status: 503 });
  const verified = verifyUnsubscribeToken(tokenFrom(request), secret);
  if (!verified.ok) return NextResponse.json({ error: 'Invalid or expired unsubscribe link' }, { status: 400 });

  const { recipientHmac, templateKey, tenantId } = verified.claims;
  const scopeKey = `${tenantId ?? 'global'}:${recipientHmac}:${templateKey}`;
  const { error } = await createServiceRoleClient().from('email_unsubscribe_preferences').insert({
    scope_key: scopeKey,
    recipient_hmac: recipientHmac,
    tenant_id: tenantId,
    template_key: templateKey,
  });
  if (error && error.code !== '23505') {
    return NextResponse.json({ error: 'Unsubscribe could not be recorded' }, { status: 503 });
  }
  return new Response('<!doctype html><html lang="en"><body><p>Unsubscribed.</p></body></html>', {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}
