// apps/web/app/api/platform/email/process/route.ts
import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { sendWithFailover } from '@elogbook/shared/email/send';
import { resendSend } from '@elogbook/shared/email/resend';
import { smtpSend } from '@elogbook/shared/email/smtp';
import { render } from '@elogbook/shared/email/templates';
import type { OutboundMessage } from '@elogbook/shared/email/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOCK_KEY = 918273;
const BULK_KEYS = new Set(['digest.weekly', 'newsletter.generic']);

type QueueRow = {
  id: string;
  template_key: string;
  to_email: string;
  to_name: string | null;
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

function unsubscribeHeader(toEmail: string, templateKey: string, baseUrl: string): Record<string, string> {
  if (!BULK_KEYS.has(templateKey)) return {};
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) return {};
  const email = toEmail.trim().toLowerCase();
  const token = createHmac('sha256', key).update(email).digest('hex');
  const link = `${baseUrl}/api/email/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
  return { 'List-Unsubscribe': `<${link}>` };
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

  // Single-worker guard: pg advisory lock so concurrent cron ticks don't double-send.
  // NOTE: supabase-js has no raw-SQL path; we try `rpc('pg_try_advisory_lock')`.
  // If that rpc function is not deployed, supabase returns an error and we proceed
  // without the lock (single-instance cron is then the only guard). Deploy a
  // `pg_try_advisory_lock(bigint)` SECURITY DEFINER wrapper to enforce it in DB.
  let lockAcquired = false;
  try {
    const rpc = (admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }).rpc.bind(admin);
    const { data, error } = await rpc('pg_try_advisory_lock', { lock_id: LOCK_KEY });
    if (!error) {
      if (data === false) {
        return NextResponse.json({ success: false, reason: 'locked' });
      }
      lockAcquired = data === true;
    }
  } catch {
    // rpc unavailable — proceed without lock (see NOTE above).
  }

  try {
    const nowIso = new Date().toISOString();
    const { data: rows } = await admin
      .from('email_queue')
      .select('id,template_key,to_email,to_name,payload,attempts,priority,created_at')
      .in('status', ['pending', 'retry'])
      .lte('next_retry_at', nowIso)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(50);

    const queue = ((rows as unknown as QueueRow[] | null) ?? []);
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

    for (const row of queue) {
      const emailNorm = (row.to_email ?? '').trim().toLowerCase();
      const attempts = row.attempts ?? 0;

      // 1. Suppression pre-check
      try {
        const { data: supp } = await admin
          .from('email_suppressions')
          .select('email')
          .eq('email', emailNorm)
          .maybeSingle();
        if (supp) {
          await admin.from('email_queue').update({ status: 'suppressed', last_error: 'suppressed' }).eq('id', row.id);
          try {
            await admin.from('email_logs').insert({
              queue_id: row.id,
              to_email: emailNorm,
              template_key: row.template_key,
              provider: 'suppressed',
              status: 'suppressed',
            });
          } catch {
            // best-effort logging
          }
          failed += 1;
          continue;
        }
      } catch {
        // If suppression lookup fails, fail open toward delivery attempt (logged below on send error).
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
        const errMsg = `template missing: ${row.template_key}`;
        await admin.from('email_queue').update({ status: 'failed', attempts: attempts + 1, last_error: errMsg }).eq('id', row.id);
        try {
          await admin.from('email_logs').insert({
            queue_id: row.id,
            to_email: emailNorm,
            template_key: row.template_key,
            provider: 'resend',
            status: 'failed',
            error: errMsg.slice(0, 2000),
          });
        } catch {
          // best-effort
        }
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
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await admin.from('email_queue').update({ status: 'failed', attempts: attempts + 1, last_error: errMsg.slice(0, 2000) }).eq('id', row.id);
        try {
          await admin.from('email_logs').insert({
            queue_id: row.id,
            to_email: emailNorm,
            template_key: row.template_key,
            provider: 'resend',
            status: 'failed',
            error: errMsg.slice(0, 2000),
          });
        } catch {
          // best-effort
        }
        failed += 1;
        continue;
      }

      // 4. Send with failover
      const msg: OutboundMessage = {
        to: emailNorm,
        toName: row.to_name ?? undefined,
        templateKey: row.template_key as OutboundMessage['templateKey'],
        subject,
        html,
        text,
        headers: unsubscribeHeader(emailNorm, row.template_key, baseUrl),
      };

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

        await admin.from('email_queue').update({ status: 'sent', attempts: attempts + 1, resend_id: result.id, last_error: null }).eq('id', row.id);
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
        const message = err instanceof Error ? err.message : String(err);
        const newAttempts = attempts + 1;
        if (status >= 400 && status < 500) {
          // Permanent failure — no retry.
          await admin.from('email_queue').update({ status: 'failed', attempts: newAttempts, last_error: message.slice(0, 2000) }).eq('id', row.id);
          try {
            await admin.from('email_logs').insert({
              queue_id: row.id,
              to_email: emailNorm,
              template_key: row.template_key,
              provider: 'resend',
              status: 'failed',
              error: message.slice(0, 2000),
            });
          } catch {
            // best-effort
          }
          failed += 1;
        } else {
          // Transient (5xx / network) — retry with backoff until 3 attempts, then dead-letter.
          if (newAttempts < 3) {
            await admin.from('email_queue').update({ status: 'retry', attempts: newAttempts, last_error: message.slice(0, 2000), next_retry_at: backoffIso(newAttempts) }).eq('id', row.id);
            try {
              await admin.from('email_logs').insert({
                queue_id: row.id,
                to_email: emailNorm,
                template_key: row.template_key,
                provider: 'resend',
                status: 'failed',
                error: `attempt ${newAttempts}: ${message}`.slice(0, 2000),
              });
            } catch {
              // best-effort
            }
            // Retry is not terminal — do not count toward `failed`.
          } else {
            await admin.from('email_queue').update({ status: 'failed', attempts: newAttempts, last_error: message.slice(0, 2000) }).eq('id', row.id);
            try {
              await admin.from('email_logs').insert({
                queue_id: row.id,
                to_email: emailNorm,
                template_key: row.template_key,
                provider: 'resend',
                status: 'failed',
                error: message.slice(0, 2000),
              });
            } catch {
              // best-effort
            }
            failed += 1;
          }
        }
      }
    }

    return NextResponse.json({ success: true, processed: queue.length, sent, failed });
  } finally {
    if (lockAcquired) {
      try {
        await (admin as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> }).rpc('pg_advisory_unlock', { lock_id: LOCK_KEY });
      } catch {
        // best-effort unlock
      }
    }
  }
}
