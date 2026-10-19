/**
 * Durable retry queue for vendor webhooks.
 *
 * `webhook_retry_queue` rows are written in the same transaction as the delivery
 * attempt log, so a failed delivery is never lost. Draining is a separate,
 * explicit operation: nothing in this repository schedules it, and no external
 * vendor is configured by default. Wire `drainWebhookRetries` to a scheduler
 * (Vercel cron / pg_cron) when a vendor integration is actually provisioned.
 *
 * Every drain runs the same opaque payload builder as the first attempt, so a
 * retry can never widen what a vendor receives.
 */

import { logger } from '@/lib/logger';
import { buildWebhookEventBody, type WebhookEventType } from './webhooks';

export const WEBHOOK_MAX_ATTEMPTS = 3;
export const WEBHOOK_RETRY_BASE_MS = 60_000;

export function retryDelayMs(attempt: number): number {
  const clamped = Math.max(1, Math.min(attempt, 10));
  return WEBHOOK_RETRY_BASE_MS * 2 ** (clamped - 1);
}

export interface WebhookRetryRow {
  id: string;
  delivery_id: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
}

export interface WebhookRetryCandidate {
  retryId: string;
  deliveryId: string;
  attempt: number;
  maxAttempts: number;
  url: string;
  tenantId: string;
  eventType: WebhookEventType;
  eventId: string;
  data: Record<string, unknown>;
  signature: string;
}

export interface WebhookRetryStore {
  dueRetries(nowIso: string, limit: number): Promise<WebhookRetryRow[]>;
  loadCandidate(retry: WebhookRetryRow): Promise<WebhookRetryCandidate | null>;
  deliver(candidate: WebhookRetryCandidate): Promise<{ ok: boolean; status: number }>;
  reschedule(retry: WebhookRetryRow, nextAttemptIso: string, attempt: number): Promise<void>;
  markExhausted(retry: WebhookRetryRow): Promise<void>;
}

export interface DrainResult {
  attempted: number;
  delivered: number;
  rescheduled: number;
  exhausted: number;
  skipped: number;
}

export async function drainWebhookRetries(
  store: WebhookRetryStore,
  options: { now?: Date; limit?: number } = {},
): Promise<DrainResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;
  const result: DrainResult = { attempted: 0, delivered: 0, rescheduled: 0, exhausted: 0, skipped: 0 };

  const due = await store.dueRetries(now.toISOString(), limit);

  for (const retry of due) {
    const attempt = retry.attempt_count + 1;
    if (attempt > retry.max_attempts) {
      await store.markExhausted(retry);
      result.exhausted += 1;
      continue;
    }

    const candidate = await store.loadCandidate(retry);
    if (!candidate) {
      // The delivery log row is gone: nothing to retry, and retrying forever
      // would be an unbounded loop.
      await store.markExhausted(retry);
      result.exhausted += 1;
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;

    let delivery: { ok: boolean; status: number };
    try {
      delivery = await store.deliver(candidate);
    } catch (error) {
      logger.error('Webhook retry delivery threw', error, { deliveryId: candidate.deliveryId });
      delivery = { ok: false, status: 0 };
    }

    if (delivery.ok) {
      result.delivered += 1;
      continue;
    }

    if (attempt >= retry.max_attempts) {
      await store.markExhausted(retry);
      result.exhausted += 1;
      continue;
    }

    await store.reschedule(retry, new Date(now.getTime() + retryDelayMs(attempt)).toISOString(), attempt);
    result.rescheduled += 1;
  }

  return result;
}

/**
 * The retry payload is rebuilt from the stored opaque metadata through the same
 * allowlist the first attempt used. If a stored delivery predates the allowlist
 * and carries free text, projection drops it rather than replaying it.
 */
export function buildRetryBody(candidate: Pick<WebhookRetryCandidate, 'tenantId' | 'eventType' | 'eventId' | 'data'>): string {
  return buildWebhookEventBody({
    tenant_id: candidate.tenantId,
    event_type: candidate.eventType,
    event_id: candidate.eventId,
    data: candidate.data,
  });
}
