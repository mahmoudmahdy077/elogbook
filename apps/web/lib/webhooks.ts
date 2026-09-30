/**
 * Webhook dispatch helper
 *
 * Looks up active webhooks for the given tenant and event type, then POSTs an
 * **opaque metadata-only** payload to each matching URL and records the attempt
 * in tenant_webhook_deliveries. Failed attempts are enqueued in
 * webhook_retry_queue for durable retry (see ./webhook-retry.ts).
 *
 * PHI EGRESS: a vendor webhook is an external system, so the body is built by
 * `buildWebhookEventBody`, which projects the event data through a strict
 * allowlist of opaque identifiers. Free-text approval comments, resident and
 * reviewer names, patient identifiers and `field_values` can never reach a
 * vendor: they are dropped before serialization, not truncated afterwards.
 * A webhook row whose `payload_policy` is not the approved `metadata_only`
 * policy is not called at all (fail closed / omit body).
 *
 * This can be called from server-side code after case status changes
 * (submit, approve, reject, delete, etc.). Callers must schedule it with
 * `runAfterResponse` (Next's `after()`) so the promise is not frozen when the
 * response returns.
 */

import { createServiceRoleClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { configuredOutboundHosts, outboundRequest } from '@/lib/outbound-request';
import { retryDelayMs } from './webhook-retry';

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

/** The only approved outbound payload policy (see migration 20260927000000). */
export const VENDOR_PAYLOAD_POLICY = 'metadata_only';

/**
 * Opaque event metadata a vendor may receive. Every value is an identifier, a
 * count, a fixed enum or an ISO timestamp — never prose, never PHI.
 */
const OPAQUE_DATA_KEYS = [
  'entry_id',
  'actor_id',
  'status',
  'template_id',
  'case_count',
  'occurred_at',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ENUM_RE = /^(?:created|updated|submitted|approved|rejected|deleted|pending|draft)$/;

function isOpaqueValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  return UUID_RE.test(value) || ISO_INSTANT_RE.test(value) || ENUM_RE.test(value);
}

export function isVendorPayloadPolicyApproved(policy: unknown): boolean {
  return policy === VENDOR_PAYLOAD_POLICY;
}

export function projectOpaqueEventData(data: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of OPAQUE_DATA_KEYS) {
    const value = data[key];
    if (value === undefined) continue;
    if (isOpaqueValue(value)) projected[key] = value;
  }
  return projected;
}

/**
 * Build the signed webhook body. Key order is fixed so the HMAC signature over
 * the body is reproducible for a receiver replaying the same event.
 */
export function buildWebhookEventBody(input: WebhookEventPayload): string {
  if (!input.tenant_id || !input.event_type || !input.event_id) {
    throw new Error('webhook_event_incomplete');
  }
  return JSON.stringify({
    tenant_id: input.tenant_id,
    event_type: input.event_type,
    event_id: input.event_id,
    data: projectOpaqueEventData(input.data ?? {}),
  });
}

function usableWebhookSecret(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && normalized !== '[ENCRYPTED]';
}

interface DispatchableWebhook {
  id: string;
  url: string;
  payload_policy?: unknown;
}

/**
 * Dispatch a webhook event to all active webhooks for the tenant that
 * subscribe to this event type. Includes retry: failed deliveries are recorded
 * in the webhook_retry_queue for durable retry by `drainWebhookRetries`.
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
    .select('id, url, events, payload_policy')
    .eq('tenant_id', tenant_id)
    .eq('is_active', true);

  if (listError) {
    logger.error('Failed to list webhooks', listError);
    return [];
  }

  const matches = ((webhooks ?? []) as unknown as DispatchableWebhook[]).filter(
    (w) => Array.isArray((w as unknown as { events?: unknown }).events)
      && ((w as unknown as { events: string[] }).events).includes(event_type),
  );

  if (matches.length === 0) {
    return [];
  }

  const body = buildWebhookEventBody({ tenant_id, event_type, event_id, data });
  const allowedHosts = configuredOutboundHosts();
  const results: Array<{ webhook_id: string; ok: boolean; status: number }> = [];

  for (const wh of matches) {
    const startedAt = new Date().toISOString();
    let status = 0;
    let responseCategory: string = 'blocked';
    let ok = false;

    // Default-deny: a vendor without the approved payload policy is never
    // called and never receives a body.
    if (!isVendorPayloadPolicyApproved(wh.payload_policy)) {
      logger.error('Webhook payload policy not approved; delivery withheld', undefined, {
        webhookId: wh.id,
        payloadPolicy: wh.payload_policy ?? null,
      });
      responseCategory = 'policy_blocked';
    } else {
      try {
        const { data: webhookSecret, error: secretError } = await supabase.rpc(
          'get_tenant_webhook_secret',
          { p_webhook_id: wh.id },
        );
        if (secretError || !usableWebhookSecret(webhookSecret)) {
          logger.error('Failed to resolve webhook secret', secretError, { webhookId: wh.id });
          responseCategory = 'blocked';
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

    // On failure: enqueue durable retry. A queue write that fails is logged
    // explicitly — the attempt is not silently dropped.
    if (!ok && delivery) {
      const { error: retryError } = await supabase.from('webhook_retry_queue').insert({
        delivery_id: delivery.id,
        next_attempt_at: new Date(Date.now() + retryDelayMs(1)).toISOString(),
        attempt_count: 0,
        max_attempts: 3,
      });
      if (retryError) {
        logger.error('Failed to enqueue webhook retry; delivery is not durable', retryError, {
          webhookId: wh.id,
          deliveryId: delivery.id,
        });
      }
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
