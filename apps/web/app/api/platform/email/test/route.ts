// apps/web/app/api/platform/email/test/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { sendWithFailover } from '@elogbook/shared/email/send';
import { resendSend } from '@elogbook/shared/email/resend';
import { smtpSend } from '@elogbook/shared/email/smtp';
import type { OutboundMessage } from '@elogbook/shared/email/types';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';

export const runtime = 'nodejs';

const testSchema = z.object({
  to: z.string().email().max(320),
  subject: z.string().min(1).max(200).default('Platform test email'),
  html: z.string().min(1).max(100000).default('<p>Platform test email.</p>'),
  text: z.string().max(100000).optional(),
}).strict();

function emailErrorCode(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? `provider_http_${status}`
    : 'provider_error';
}

export async function POST(request: Request) {
  const guarded = await guardRequest(request, testSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 128 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });

  const ip = getClientIp(request);
  const rl = await checkRateLimit(`email-test:${ip}`, 5);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const parsed = { data: guarded.data, success: true as const };

  const from = process.env.EMAIL_FROM;
  if (!from) return NextResponse.json({ error: 'EMAIL_FROM is not configured' }, { status: 500 });

  const provider = process.env.EMAIL_PROVIDER ?? 'resend+smtp';
  const apiKey = process.env.RESEND_API_KEY ?? '';
  const smtpCfg = {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587) || 587,
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from,
  };

  const msg: OutboundMessage = {
    to: parsed.data.to.trim().toLowerCase(),
    templateKey: 'newsletter.generic',
    subject: parsed.data.subject,
    html: parsed.data.html,
    text: parsed.data.text,
  };

  const admin = createServiceRoleClient();
  const attemptId = randomUUID();
  const selectedProvider = provider === 'smtp-only' ? 'smtp' : 'resend';
  const { error: auditStartError } = await admin.from('email_send_audit').insert({
    attempt_id: attemptId,
    tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
    template_key: 'newsletter.generic',
    provider: selectedProvider,
    phase: 'started',
  });
  if (auditStartError) {
    return NextResponse.json({ error: 'Email audit is unavailable' }, { status: 503 });
  }

  try {
    const result = await sendWithFailover(msg, {
      resend: (m) => {
        if (provider === 'smtp-only' || !apiKey) {
          throw Object.assign(new Error('resend not configured'), { status: 500 });
        }
        return resendSend(apiKey, from, { to: m.to, subject: m.subject, html: m.html, text: m.text });
      },
      smtp: (m) => {
        if (!smtpCfg.host) throw Object.assign(new Error('smtp not configured'), { status: 500 });
        return smtpSend(smtpCfg, { to: m.to, subject: m.subject, html: m.html, text: m.text });
      },
    });

    await admin.from('email_send_audit').insert({
      attempt_id: attemptId,
      tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
      template_key: 'newsletter.generic',
      provider: result.via,
      phase: 'accepted',
      provider_id: result.id,
    });
    return NextResponse.json({ success: true, via: result.via, id: result.id });
  } catch (err) {
    const code = emailErrorCode(err);
    const status = (err as { status?: number }).status ?? 500;
    await admin.from('email_send_audit').insert({
      attempt_id: attemptId,
      tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
      template_key: 'newsletter.generic',
      provider: selectedProvider,
      phase: status >= 400 && status < 500 ? 'rejected' : 'retryable',
      error_code: code,
    });
    await admin.from('email_logs').insert({
      to_email: msg.to,
      template_key: 'newsletter.generic',
      provider: selectedProvider,
      status: 'failed',
      error: code,
    });
    return NextResponse.json({ error: 'Email provider rejected or could not accept the message' }, { status: 502 });
  }
}
