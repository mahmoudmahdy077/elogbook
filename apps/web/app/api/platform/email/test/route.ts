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

export const runtime = 'nodejs';

const testSchema = z.object({
  to: z.string().email().max(320),
  subject: z.string().min(1).max(200).default('Platform test email'),
  html: z.string().min(1).max(100000).default('<p>Platform test email.</p>'),
  text: z.string().max(100000).optional(),
});

export async function POST(request: Request) {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });

  const ip = getClientIp(request);
  const rl = await checkRateLimit(`email-test:${ip}`, 5);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }

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

    const admin = createServiceRoleClient();
    try {
      await admin.from('email_logs').insert({
        to_email: msg.to,
        template_key: 'newsletter.generic',
        provider: result.via,
        provider_id: result.id,
        status: 'sent',
      });
    } catch {
      console.warn('[platform-email] email_logs insert failed for test send', msg.to);
    }
    try {
      await admin.from('audit_logs').insert({
        tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
        user_id: platform.user.id,
        action: 'email.test',
        resource_type: 'email',
        resource_id: randomUUID(),
        changes: { to: msg.to, via: result.via, provider_id: result.id },
      });
    } catch {
      console.warn('[platform-email] audit insert failed for email.test', msg.to);
    }

    return NextResponse.json({ success: true, via: result.via, id: result.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await createServiceRoleClient().from('email_logs').insert({
        to_email: msg.to,
        template_key: 'newsletter.generic',
        provider: 'resend',
        status: 'failed',
        error: message.slice(0, 2000),
      });
    } catch {
      // best-effort logging only
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
