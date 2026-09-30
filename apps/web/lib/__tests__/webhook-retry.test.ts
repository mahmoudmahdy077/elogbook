import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  drainWebhookRetries,
  retryDelayMs,
  buildRetryBody,
  type WebhookRetryCandidate,
  type WebhookRetryRow,
  type WebhookRetryStore,
} from '../webhook-retry';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const DELIVERY_ID = '11111111-1111-4111-8111-111111111111';
const RETRY_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '44444444-4444-4444-8444-444444444444';

function retryRow(overrides: Partial<WebhookRetryRow> = {}): WebhookRetryRow {
  return {
    id: RETRY_ID,
    delivery_id: DELIVERY_ID,
    attempt_count: 0,
    max_attempts: 3,
    next_attempt_at: new Date(NOW.getTime() - 1000).toISOString(),
    ...overrides,
  };
}

function candidate(overrides: Partial<WebhookRetryCandidate> = {}): WebhookRetryCandidate {
  return {
    retryId: RETRY_ID,
    deliveryId: DELIVERY_ID,
    attempt: 1,
    maxAttempts: 3,
    url: 'https://hooks.example.com/elogbook',
    tenantId: TENANT_ID,
    eventType: 'case.approved',
    eventId: ENTRY_ID,
    data: { entry_id: ENTRY_ID, comment: 'Dr Smith approved this case' },
    signature: 'sha256=abc',
    ...overrides,
  };
}

interface Recorder {
  store: WebhookRetryStore;
  rescheduled: Array<{ nextAttempt: string; attempt: number }>;
  exhausted: WebhookRetryRow[];
  delivered: number;
}

function recorder(options: {
  rows?: WebhookRetryRow[];
  candidate?: WebhookRetryCandidate | null;
  deliver?: (c: WebhookRetryCandidate) => Promise<{ ok: boolean; status: number }>;
}): Recorder {
  const rescheduled: Array<{ nextAttempt: string; attempt: number }> = [];
  const exhausted: WebhookRetryRow[] = [];
  const state = { delivered: 0 };
  const store: WebhookRetryStore = {
    dueRetries: async () => options.rows ?? [retryRow()],
    loadCandidate: async () => (options.candidate === undefined ? candidate() : options.candidate),
    deliver: async (c) => {
      state.delivered += 1;
      return options.deliver ? options.deliver(c) : { ok: true, status: 200 };
    },
    reschedule: async (_row, nextAttemptIso, attempt) => {
      rescheduled.push({ nextAttempt: nextAttemptIso, attempt });
    },
    markExhausted: async (row) => {
      exhausted.push(row);
    },
  };
  return {
    store,
    rescheduled,
    exhausted,
    get delivered() { return state.delivered; },
  } as Recorder;
}

describe('retryDelayMs', () => {
  it('backs off exponentially from the base delay', () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBe(240_000);
  });

  it('clamps a nonsensical attempt count', () => {
    expect(retryDelayMs(0)).toBe(60_000);
    expect(retryDelayMs(99)).toBe(60_000 * 2 ** 9);
  });
});

describe('buildRetryBody', () => {
  it('re-projects the retry payload through the opaque allowlist', () => {
    const body = JSON.parse(
      buildRetryBody({
        tenantId: TENANT_ID,
        eventType: 'case.approved',
        eventId: ENTRY_ID,
        data: { entry_id: ENTRY_ID, comment: 'Dr Smith approved this case' },
      }),
    );

    expect(body.data).toEqual({ entry_id: ENTRY_ID });
    expect(JSON.stringify(body)).not.toContain('Dr Smith');
  });
});

describe('drainWebhookRetries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no retry is due', async () => {
    const r = recorder({ rows: [] });

    const result = await drainWebhookRetries(r.store, { now: NOW });

    expect(result).toEqual({ attempted: 0, delivered: 0, rescheduled: 0, exhausted: 0, skipped: 0 });
    expect(r.delivered).toBe(0);
  });

  it('delivers a due retry successfully', async () => {
    const r = recorder({});

    const result = await drainWebhookRetries(r.store, { now: NOW });

    expect(result).toEqual({ attempted: 1, delivered: 1, rescheduled: 0, exhausted: 0, skipped: 0 });
    expect(r.rescheduled).toHaveLength(0);
  });

  it('reschedules with exponential backoff when a retry fails', async () => {
    const r = recorder({ deliver: async () => ({ ok: false, status: 500 }) });

    const result = await drainWebhookRetries(r.store, { now: NOW });

    expect(result).toEqual({ attempted: 1, delivered: 0, rescheduled: 1, exhausted: 0, skipped: 0 });
    expect(r.rescheduled).toEqual([{ nextAttempt: new Date(NOW.getTime() + 60_000).toISOString(), attempt: 1 }]);
  });

  it('treats a thrown delivery as a failure and still schedules a retry', async () => {
    const r = recorder({
      deliver: async () => { throw new Error('socket hang up'); },
    });

    const result = await drainWebhookRetries(r.store, { now: NOW });

    expect(result.rescheduled).toBe(1);
    expect(r.exhausted).toHaveLength(0);
  });

  it('exhausts the queue on the final attempt instead of looping forever', async () => {
    const r = recorder({
      rows: [retryRow({ attempt_count: 2, max_attempts: 3 })],
      deliver: async () => ({ ok: false, status: 500 }),
    });

    const result = await drainWebhookRetries(r.store, { now: NOW });

    expect(result).toEqual({ attempted: 1, delivered: 0, rescheduled: 0, exhausted: 1, skipped: 0 });
    expect(r.rescheduled).toHaveLength(0);
  });

  it('skips a retry whose delivery record no longer exists', async () => {
    const r = recorder({ candidate: null });

    const result = await drainWebhookRetries(r.store, { now: NOW });

    expect(result).toEqual({ attempted: 0, delivered: 0, rescheduled: 0, exhausted: 1, skipped: 1 });
    expect(r.delivered).toBe(0);
  });
});
