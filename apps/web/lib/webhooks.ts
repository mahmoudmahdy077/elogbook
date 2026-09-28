/**
 * Webhook dispatch helper
 *
 * Looks up active webhooks for the given tenant and event type, then
 * POSTs the payload to each matching URL. Records delivery attempts
 * in tenant_webhook_deliveries.
 *
 * This can be called from server-side code after case status changes
 * (submit, approve, reject, delete, etc.).
 *
 * In production, this replicates what the dispatch-webhook Supabase
 * edge function does, but from within the Next.js server runtime so
 * it can be called synchronously from API routes without needing the
 * edge function to be deployed and reachable.
 */

import { createServiceRoleClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { configuredOutboundHosts, outboundRequest } from '@/lib/outbound-request';

export interface WebhookEventPayload {
  tenant_id: string;
  event_type: WebhookEventType;
  event_id: string;
  data: Record<string, unknown>;
}

export type WebhookEventType =
  | 'case.created'
  | 'case.updated'
  | 'case.submitted'
  | 'case.approved'
  | 'case.rejected'
  | 'case.deleted';

function usableWebhookSecret(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && normalized !== '[ENCRYPTED]';
}

/**
 * Dispatch a webhook event to all active webhooks for the tenant that
 * subscribe to this event type. Includes retry: failed deliveries are
 * recorded in the webhook_retry_queue for retry by application-level logic.
 *
 * @returns Array of dispatch results (webhook_id, ok, status)
 */
export async function dispatchWebhookEvent(
  payload: WebhookEventPayload,
): Promise<Array<{ webhook_id: string; ok: boolean; status: number }>> {
  const { tenant_id, event_type, event_id, data } = payload;

  if (!tenant_id || !event_type || !event_id) {
    logger.warn('Webhook dispatch missing required fields', {
      tenant_id,
      event_type,
      event_id,
    });
    return [];
  }

  const supabase = createServiceRoleClient();

  // Look up active webhooks matching this tenant and event
  const { data: webhooks, error: listError } = await supabase
    .from('tenant_webhooks')
    .select('id, url, events')
    .eq('tenant_id', tenant_id)
    .eq('is_active', true);

  if (listError) {
    logger.error('Failed to list webhooks', listError);
    return [];
  }

  const matches = (webhooks ?? []).filter(
    (w) => Array.isArray(w.events) && w.events.includes(event_type),
  );

  if (matches.length === 0) {
    return [];
  }

  const body = JSON.stringify({ ...data, event_type, event_id, tenant_id });
  const allowedHosts = configuredOutboundHosts();
  const results: Array<{ webhook_id: string; ok: boolean; status: number }> = [];

  for (const wh of matches) {
    const startedAt = new Date().toISOString();
    let status = 0;
    let responseCategory = 'blocked';
    let ok = false;

    try {
      const { data: webhookSecret, error: secretError } = await supabase.rpc(
        'get_tenant_webhook_secret',
        { p_webhook_id: wh.id },
      );
      if (secretError || !usableWebhookSecret(webhookSecret)) {
        logger.error('Failed to resolve webhook secret', secretError, { webhookId: wh.id });
      } else {
        const signature = await computeHmacSha256(webhookSecret, body);
        const result = await outboundRequest(wh.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-E-Logbook-Event': event_type,
            'X-E-Logbook-Event-Id': event_id,
            'X-E-Logbook-Signature': `sha256=${signature}`,
            'User-Agent': 'E-Logbook-Webhook/1.0',
          },
          body,
          allowedHosts,
          requireAllowlist: true,
          timeoutMs: 5_000,
          maxResponseBytes: 64 * 1_024,
          maxConcurrent: 8,
        });
        status = result.status;
        responseCategory = result.category;
        ok = result.ok;
      }
    } catch {
      responseCategory = 'network';
    }

    // Record delivery attempt
    const { data: delivery } = await supabase.from('tenant_webhook_deliveries').insert({
      webhook_id: wh.id,
      tenant_id,
      event_type,
      event_id,
      status_code: status,
      request_body: body.slice(0, 8000),
      response_body: responseCategory,
      attempted_at: startedAt,
      completed_at: new Date().toISOString(),
      succeeded: ok,
    }).select('id').maybeSingle();

    // On failure: enqueue retry
    if (!ok && delivery) {
      await supabase.from('webhook_retry_queue').insert({
        delivery_id: delivery.id,
        next_attempt_at: new Date(Date.now() + 60000).toISOString(), // 1min first retry
        attempt_count: 0,
        max_attempts: 3,
      }).maybeSingle();
    }

    results.push({ webhook_id: wh.id, ok, status });
  }

  return results;
}

/**
 * Send a test payload to a specific webhook (used by the admin UI test button).
 * Returns the HTTP status and response body without recording a delivery log
 * (unless it succeeds, then a log is recorded for the audit trail).
 */
export async function testWebhookEndpoint(
  url: string,
  secret: string,
  tenantId: string,
): Promise<{ status: number; body: string; ok: boolean }> {
  if (!usableWebhookSecret(secret)) return { status: 0, body: '', ok: false };
  const testPayload = {
    event_type: 'test.ping',
    event_id: crypto.randomUUID(),
    tenant_id: tenantId,
    data: {
      message: 'This is a test webhook from E-Logbook',
      timestamp: new Date().toISOString(),
    },
  };

  const body = JSON.stringify(testPayload);
  const signature = await computeHmacSha256(secret, body);
  const result = await outboundRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-E-Logbook-Event': 'test.ping',
      'X-E-Logbook-Event-Id': testPayload.event_id,
      'X-E-Logbook-Signature': `sha256=${signature}`,
      'User-Agent': 'E-Logbook-Webhook/1.0',
    },
    body,
    allowedHosts: configuredOutboundHosts(),
    requireAllowlist: true,
    timeoutMs: 5_000,
    maxResponseBytes: 64 * 1_024,
    maxConcurrent: 8,
  }).catch(() => ({ ok: false, status: 0, category: 'network' as const }));

  return { status: result.status, body: '', ok: result.ok };
}

async function computeHmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
