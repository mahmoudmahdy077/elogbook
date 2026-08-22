import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
    },
  };
});

Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: () => 'test-uuid-1234' },
});

import {
  initTelemetry, trackEvent,
  recordSyncResult, getSyncMetrics, isSyncHealthy, flushEventQueue,
  getEventQueueSize,
} from '../telemetry';

describe('telemetry', () => {
  beforeEach(async () => {
    initTelemetry('user-1');
    await flushEventQueue();
  });

  it('tracks events', async () => {
    await trackEvent('test_event', { key: 'value' });
    const queue = await flushEventQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.event).toBe('test_event');
    expect(queue[0]!.properties.key).toBe('value');
    expect(queue[0]!.userId).toBe('user-1');
  });

  it('tracks sync results', async () => {
    await recordSyncResult({
      success: true, pulled: 10, pushed: 5, conflicts: 1, durationMs: 1500, errors: [],
    });
    const m = await getSyncMetrics();
    expect(m.totalSyncs).toBe(1);
    expect(m.successfulSyncs).toBe(1);
    expect(m.totalPulled).toBe(10);
  });

  it('tracks sync failures', async () => {
    await recordSyncResult({
      success: false, pulled: 0, pushed: 0, conflicts: 0, durationMs: 500, errors: ['timeout'],
    });
    const m = await getSyncMetrics();
    expect(m.failedSyncs).toBe(1);
    expect(m.lastSyncErrors).toContain('timeout');
  });

  it('reports sync health', async () => {
    // 3 successful, 0 failed → healthy
    for (let i = 0; i < 3; i++) {
      await recordSyncResult({ success: true, pulled: 1, pushed: 1, conflicts: 0, durationMs: 100, errors: [] });
    }
    expect(await isSyncHealthy()).toBe(true);
  });

  it('reports unhealthy when failure rate > 30%', async () => {
    for (let i = 0; i < 7; i++) {
      await recordSyncResult({ success: false, pulled: 0, pushed: 0, conflicts: 0, durationMs: 100, errors: ['err'] });
    }
    for (let i = 0; i < 3; i++) {
      await recordSyncResult({ success: true, pulled: 1, pushed: 1, conflicts: 0, durationMs: 100, errors: [] });
    }
    expect(await isSyncHealthy()).toBe(false);
  });

  it('event queue respects max size', async () => {
    for (let i = 0; i < 250; i++) {
      await trackEvent('event_' + i);
    }
    const size = await getEventQueueSize();
    expect(size).toBeLessThanOrEqual(200);
  });
});
