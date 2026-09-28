// apps/web/app/api/platform/email/process/route.ts
import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import {
  buildListUnsubscribeHeaders,
  createUnsubscribeToken,
  validateEmailQueuePayload,
} from '@elogbook/shared/email/safety';
import { sendWithFailover } from '@elogbook/shared/email/send';
import { resendSend } from '@elogbook/shared/email/resend';
import { smtpSend } from '@elogbook/shared/email/smtp';
import { render } from '@elogbook/shared/email/templates';
import type { OutboundMessage } from '@elogbook/shared/email/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLAIM_BATCH_SIZE = 50;
const CLAIM_LEASE_SECONDS = 3600;
const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

type QueueRow = {
  id: string;
  lease_token: string;
  template_key: string;
  to_email: string;
  to_name: string | null;
  tenant_id: string | null;
  payload: Record<string, string>;
  attempts: number;
  priority?: number;
  created_at?: string;
};

function getBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  try {
    return new URL(request.url).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

type AdminClient = ReturnType<typeof createServiceRoleClient>;

function emailErrorCode(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    return `provider_http_${status}`;
  }
  return 'provider_error';
}

async function recordSendAudit(
  admin: AdminClient,
  row: {
    attemptId: string;
    queueId: string;
    tenantId: string | null;
    templateKey: string;
    provider: 'resend' | 'smtp';
    phase: 'started' | 'accepted' | 'rejected' | 'retryable' | 'configuration' | 'ambiguous' | 'suppressed';
    providerId?: string;
    errorCode?: string;
  },
): Promise<boolean> {
  const { error } = await admin.from('email_send_audit').insert({
    attempt_id: row.attemptId,
    queue_id: row.queueId,
    tenant_id: row.tenantId,
    template_key: row.templateKey,
    provider: row.provider,
    phase: row.phase,
    provider_id: row.providerId ?? null,
    error_code: row.errorCode ?? null,
  });
  return !error;
}

function backoffIso(newAttempts: number): string {
  const minutes = newAttempts <= 1 ? 5 : 30;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.EMAIL_CRON_SECRET || secret !== process.env.EMAIL_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createServiceRoleClient();

  let claimResult: { data: unknown; error: unknown };
  try {
    claimResult = await admin.rpc('claim_email_queue', {
      p_limit: CLAIM_BATCH_SIZE,
      p_lease_seconds: CLAIM_LEASE_SECONDS,
    });
  } catch {
    return NextResponse.json({ error: 'Email queue unavailable' }, { status: 503 });
  }
  const { data: claimedRows, error: claimError } = claimResult;
  if (claimError) {
    return NextResponse.json({ error: 'Email queue unavailable' }, { status: 503 });
  }
  if (!Array.isArray(claimedRows)) {
    return NextResponse.json({ error: 'Email queue unavailable' }, { status: 503 });
  }

  const queue = claimedRows as unknown as QueueRow[];
  if (queue.some((row) => !row.id || typeof row.lease_token !== 'string' || !row.lease_token)) {
    return NextResponse.json({ error: 'Email queue unavailable' }, { status: 503 });
  }

  let sent = 0;
  let failed = 0;

    const from = process.env.EMAIL_FROM ?? '';
    const apiKey = process.env.RESEND_API_KEY ?? '';
    const providerMode = process.env.EMAIL_PROVIDER ?? 'resend+smtp';
    const smtpCfg = {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 587) || 587,
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
      from,
    };
    const baseUrl = getBaseUrl(request);
    const tokenSecret = process.env.EMAIL_TOKEN_SIGNING_SECRET ?? '';
    const lookupSecret = process.env.EMAIL_LOOKUP_HMAC_KEY ?? '';

    for (const row of queue) {
      const emailNorm = (row.to_email ?? '').trim().toLowerCase();
      const attempts = row.attempts ?? 0;
      const tenantId = typeof row.tenant_id === 'string' ? row.tenant_id : null;
      const recipientHmac = lookupSecret.length >= 32
        ? createHmac('sha256', lookupSecret).update(emailNorm).digest('hex')
        : '';

      const { data: supp, error: suppressionError } = await admin
        .from('email_suppressions')
        .select('email')
        .eq('email', emailNorm)
        .maybeSingle();
      if (suppressionError) {
        await admin.from('email_queue').update({
          status: 'retry',
          attempts: attempts + 1,
          last_error: 'suppression_check_failed',
          next_retry_at: backoffIso(attempts + 1),
        }).eq('id', row.id).eq('lease_token', row.lease_token);
        failed += 1;
        continue;
      }
      if (supp) {
        await admin.from('email_queue').update({ status: 'suppressed', last_error: 'suppressed' }).eq('id', row.id).eq('lease_token', row.lease_token);
        await admin.from('email_logs').insert({
          queue_id: row.id,
          to_email: emailNorm,
          template_key: row.template_key,
          provider: 'suppressed',
          status: 'suppressed',
        });
        failed += 1;
        continue;
      }

      if (tokenSecret.length < 32 || lookupSecret.length < 32 || !recipientHmac) {
        await admin.from('email_queue').update({
          status: 'failed',
          attempts: attempts + 1,
          last_error: 'unsubscribe_configuration_missing',
        }).eq('id', row.id).eq('lease_token', row.lease_token);
        failed += 1;
        continue;
      }

      let unsubscribeQuery = admin
        .from('email_unsubscribe_preferences')
        .select('scope_key')
        .eq('recipient_hmac', recipientHmac)
        .eq('template_key', row.template_key);
      unsubscribeQuery = tenantId
        ? unsubscribeQuery.eq('tenant_id', tenantId)
        : unsubscribeQuery.is('tenant_id', null);
      const { data: unsubscribed, error: unsubscribeError } = await unsubscribeQuery.maybeSingle();
      if (unsubscribeError) {
        await admin.from('email_queue').update({
          status: 'retry',
          attempts: attempts + 1,
          last_error: 'unsubscribe_check_failed',
          next_retry_at: backoffIso(attempts + 1),
        }).eq('id', row.id).eq('lease_token', row.lease_token);
        failed += 1;
        continue;
      }
      if (unsubscribed) {
        await admin.from('email_queue').update({ status: 'suppressed', last_error: 'unsubscribed' }).eq('id', row.id).eq('lease_token', row.lease_token);
        failed += 1;
        continue;
      }

      const payloadValidation = validateEmailQueuePayload(row.payload ?? {});
      if (!payloadValidation.ok) {
        await admin.from('email_queue').update({
          status: 'failed',
          attempts: attempts + 1,
          last_error: 'invalid_queue_payload',
        }).eq('id', row.id).eq('lease_token', row.lease_token);
        failed += 1;
        continue;
      }

      // 2. Template fetch (active only)
      const { data: tpl } = await admin
        .from('email_templates')
        .select('subject,html,text')
        .eq('key', row.template_key)
        .eq('active', true)
        .maybeSingle();
      const template = tpl as unknown as { subject: string; html: string; text: string | null } | null;
      if (!template) {
        await admin.from('email_queue').update({ status: 'failed', attempts: attempts + 1, last_error: 'template_missing' }).eq('id', row.id).eq('lease_token', row.lease_token);
        await admin.from('email_logs').insert({
          queue_id: row.id,
          to_email: emailNorm,
          template_key: row.template_key,
          provider: 'resend',
          status: 'failed',
          error: 'template_missing',
        });
        failed += 1;
        continue;
      }

      // 3. Render
      let subject: string;
      let html: string;
      let text: string | undefined;
      try {
        const vars = (row.payload ?? {}) as Record<string, string>;
        const rendered = render(template, vars);
        subject = rendered.subject;
        html = rendered.html;
        text = rendered.text;
      } catch {
        await admin.from('email_queue').update({ status: 'failed', attempts: attempts + 1, last_error: 'template_render_failed' }).eq('id', row.id).eq('lease_token', row.lease_token);
        await admin.from('email_logs').insert({
          queue_id: row.id,
          to_email: emailNorm,
          template_key: row.template_key,
          provider: 'resend',
          status: 'failed',
          error: 'template_render_failed',
        });
        failed += 1;
        continue;
      }

      let headers: Record<string, string>;
      try {
        const token = createUnsubscribeToken({
          recipientHmac,
          templateKey: row.template_key,
          tenantId,
          expiresAt: Math.floor(Date.now() / 1000) + UNSUBSCRIBE_TOKEN_TTL_SECONDS,
        }, tokenSecret);
        headers = buildListUnsubscribeHeaders({ baseUrl, token });
      } catch {
        await admin.from('email_queue').update({
          status: 'failed',
          attempts: attempts + 1,
          last_error: 'unsubscribe_configuration_invalid',
        }).eq('id', row.id).eq('lease_token', row.lease_token);
        failed += 1;
        continue;
      }

      const msg: OutboundMessage = {
        to: emailNorm,
        toName: row.to_name ?? undefined,
        templateKey: row.template_key as OutboundMessage['templateKey'],
        subject,
        html,
        text,
        headers,
      };

      const attemptId = crypto.randomUUID();
      const selectedProvider = providerMode === 'smtp-only' ? 'smtp' : 'resend';
      const auditedStart = await recordSendAudit(admin, {
        attemptId,
        queueId: row.id,
        tenantId,
        templateKey: row.template_key,
        provider: selectedProvider,
        phase: 'started',
      });
      if (!auditedStart) {
        await admin.from('email_queue').update({
          status: 'retry',
          attempts: attempts + 1,
          last_error: 'audit_unavailable',
          next_retry_at: backoffIso(attempts + 1),
        }).eq('id', row.id).eq('lease_token', row.lease_token);
        failed += 1;
        continue;
      }

      try {
        const result = await sendWithFailover(msg, {
          resend: (m) => {
            if (providerMode === 'smtp-only' || !apiKey) {
              throw Object.assign(new Error('resend not configured'), { status: 500 });
            }
            return resendSend(apiKey, from, { to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
          },
          smtp: (m) => {
            if (!smtpCfg.host) throw Object.assign(new Error('smtp not configured'), { status: 500 });
            return smtpSend(smtpCfg, { to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
          },
        });

        await recordSendAudit(admin, {
          attemptId,
          queueId: row.id,
          tenantId,
          templateKey: row.template_key,
          provider: result.via,
          phase: 'accepted',
          providerId: result.id,
        });
        await admin.from('email_queue').update({ status: 'sent', attempts: attempts + 1, resend_id: result.id, last_error: null }).eq('id', row.id).eq('lease_token', row.lease_token);
        try {
          await admin.from('email_logs').insert({
            queue_id: row.id,
            to_email: emailNorm,
            template_key: row.template_key,
            provider: result.via,
            provider_id: result.id,
            status: 'sent',
          });
        } catch {
          // best-effort
        }
        sent += 1;
      } catch (err) {
        const status = (err as { status?: number }).status ?? 500;
        const code = emailErrorCode(err);
        const newAttempts = attempts + 1;
        const phase = status === 401 || status === 403
          ? 'configuration'
          : status >= 400 && status < 500
            ? 'rejected'
            : 'retryable';
        await recordSendAudit(admin, {
          attemptId,
          queueId: row.id,
          tenantId,
          templateKey: row.template_key,
          provider: selectedProvider,
          phase,
          errorCode: code,
        });
        if (status >= 400 && status < 500) {
          await admin.from('email_queue').update({ status: 'failed', attempts: newAttempts, last_error: code }).eq('id', row.id).eq('lease_token', row.lease_token);
          await admin.from('email_logs').insert({
            queue_id: row.id,
            to_email: emailNorm,
            template_key: row.template_key,
            provider: selectedProvider,
            status: 'failed',
            error: code,
          });
          failed += 1;
        } else if (newAttempts < 3) {
          await admin.from('email_queue').update({ status: 'retry', attempts: newAttempts, last_error: code, next_retry_at: backoffIso(newAttempts) }).eq('id', row.id).eq('lease_token', row.lease_token);
          await admin.from('email_logs').insert({
            queue_id: row.id,
            to_email: emailNorm,
            template_key: row.template_key,
            provider: selectedProvider,
            status: 'failed',
            error: code,
          });
        } else {
          await admin.from('email_queue').update({ status: 'failed', attempts: newAttempts, last_error: code }).eq('id', row.id).eq('lease_token', row.lease_token);
          await admin.from('email_logs').insert({
            queue_id: row.id,
            to_email: emailNorm,
            template_key: row.template_key,
            provider: selectedProvider,
            status: 'failed',
            error: code,
          });
          failed += 1;
        }
      }
    }

  return NextResponse.json({ success: true, processed: queue.length, sent, failed });
}
