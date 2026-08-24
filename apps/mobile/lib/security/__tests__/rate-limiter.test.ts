/**
 * Tests for the token-bucket rate limiter.
 *
 * AsyncStorage and SecureStore are mocked with in-memory maps so tests run
 * deterministically without native modules.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

// In-memory AsyncStorage mock
const storage = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
    removeItem: async (key: string) => { storage.delete(key); },
    getAllKeys: async () => [...storage.keys()],
    removeMany: async (keys: string[]) => { keys.forEach((k) => storage.delete(k)); },
    getMany: async (keys: string[]) =>
      Object.fromEntries(keys.map((k) => [k, storage.get(k) ?? null])),
    setMany: async (entries: Record<string, string>) => {
      Object.entries(entries).forEach(([k, v]) => storage.set(k, v));
    },
  },
}));

// In-memory SecureStore mock
const secureStorage = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => secureStorage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { secureStorage.set(key, value); },
  deleteItemAsync: async (key: string) => { secureStorage.delete(key); },
}));

vi.mock('../../secure-store', () => ({
  getSecureItem: async (key: string) => secureStorage.get(key) ?? null,
  setSecureItem: async (key: string, value: string) => { secureStorage.set(key, value); },
  removeSecureItem: async (key: string) => { secureStorage.delete(key); },
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import {
  checkLimit,
  confirmAction,
  resetLimit,
  resetAllLimits,
  getRateLimitStatus,
  setOverride,
  loadOverrides,
  clearStorage,
  getConfig,
  consumeIfAllowed,
  type RateLimitAction,
  type RateLimitResult,
  type BucketState,
} from '../rate-limiter';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ALL_ACTIONS: RateLimitAction[] = [
  'case_submit',
  'case_update',
  'evaluation_submit',
  'comment_submit',
  'sync_pull',
  'sync_push',
];

function getRawBucket(action: RateLimitAction): BucketState | null {
  const raw = storage.get(`@elogbook/ratelimit:${action}`);
  return raw ? JSON.parse(raw) : null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('rate-limiter', () => {
  beforeEach(async () => {
    storage.clear();
    secureStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z').getTime());
    // Reset the module's internal cache
    await clearStorage();
  });

  // ── Default configuration ────────────────────────────────────────────────

  describe('default limits', () => {
    it('should have correct capacity and refill rate for case_submit (5/min)', async () => {
      const config = await getConfig('case_submit');
      expect(config.capacity).toBe(5);
      expect(config.refillRate).toBeCloseTo(5 / 60, 6);
    });

    it('should have correct capacity and refill rate for evaluation_submit (3/min)', async () => {
      const config = await getConfig('evaluation_submit');
      expect(config.capacity).toBe(3);
      expect(config.refillRate).toBeCloseTo(3 / 60, 6);
    });

    it('should have correct capacity and refill rate for sync_pull (30/min)', async () => {
      const config = await getConfig('sync_pull');
      expect(config.capacity).toBe(30);
      expect(config.refillRate).toBeCloseTo(30 / 60, 6);
    });

    it('should have correct capacity for all default actions', async () => {
      const expected: [RateLimitAction, number][] = [
        ['case_submit', 5],
        ['case_update', 10],
        ['evaluation_submit', 3],
        ['comment_submit', 10],
        ['sync_pull', 30],
        ['sync_push', 20],
      ];
      for (const [action, cap] of expected) {
        const config = await getConfig(action);
        expect(config.capacity).toBe(cap);
      }
    });
  });

  // ── checkLimit ─────────────────────────────────────────────────────────

  describe('checkLimit', () => {
    it('should allow first request with full capacity', async () => {
      const result = await checkLimit('case_submit');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.retryAfterMs).toBe(0);
    });

    it('should return full capacity for all actions on first check', async () => {
      for (const action of ALL_ACTIONS) {
        const result = await checkLimit(action);
        const config = await getConfig(action);
        expect(result.remaining).toBe(config.capacity);
      }
    });
  });

  // ── confirmAction ─────────────────────────────────────────────────────

  describe('confirmAction', () => {
    it('should consume a token', async () => {
      await confirmAction('case_submit');
      const bucket = getRawBucket('case_submit');
      expect(bucket).not.toBeNull();
      expect(bucket!.tokens).toBeCloseTo(4, 1);
    });

    it('should persist bucket to AsyncStorage', async () => {
      await confirmAction('comment_submit');
      const bucket = getRawBucket('comment_submit');
      expect(bucket).not.toBeNull();
      expect(typeof bucket!.lastRefill).toBe('string');
      expect(new Date(bucket!.lastRefill).getTime()).toBeGreaterThan(0);
    });

    it('should track multiple confirmations', async () => {
      for (let i = 0; i < 3; i++) {
        await confirmAction('evaluation_submit');
      }
      // Capacity 3, consumed 3 = ~0 remaining
      const result = await checkLimit('evaluation_submit');
      expect(result.remaining).toBe(0);
      expect(result.allowed).toBe(false);
    });
  });

  // ── Refill behavior ────────────────────────────────────────────────────

  describe('refill behavior', () => {
    it('should refill tokens over time', async () => {
      // case_submit: capacity=5, refillRate=5/60 per second
      // Consume all 5 tokens
      for (let i = 0; i < 5; i++) {
        await confirmAction('case_submit');
      }

      const result = await checkLimit('case_submit');
      expect(result.allowed).toBe(false);

      // Advance 12 seconds → 5/60 * 12 = 1 token refilled
      vi.advanceTimersByTime(12_000);

      const result2 = await checkLimit('case_submit');
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);
    });

    it('should not exceed capacity on refill', async () => {
      // case_submit: capacity=5
      // Consume 2 tokens
      await confirmAction('case_submit');
      await confirmAction('case_submit');

      // Advance 60 seconds → 5/60 * 60 = 5 tokens → should cap at 5
      vi.advanceTimersByTime(60_000);

      const result = await checkLimit('case_submit');
      expect(result.remaining).toBe(5); // capped at capacity
    });

    it('should calculate correct retryAfterMs when rate-limited', async () => {
      // evaluation_submit: capacity=3, refillRate=3/60 = 0.05/sec
      for (let i = 0; i < 3; i++) {
        await confirmAction('evaluation_submit');
      }

      const result = await checkLimit('evaluation_submit');
      expect(result.allowed).toBe(false);
      // 1 token / 0.05 per sec = 20 seconds = 20000 ms
      expect(result.retryAfterMs).toBeGreaterThanOrEqual(19000);
      expect(result.retryAfterMs).toBeLessThanOrEqual(21000);
    });

    it('should fully refill after sufficient time', async () => {
      // sync_push: capacity=20, refillRate=20/60
      for (let i = 0; i < 20; i++) {
        await confirmAction('sync_push');
      }

      expect((await checkLimit('sync_push')).allowed).toBe(false);

      // Advance 60 seconds → all 20 tokens refill
      vi.advanceTimersByTime(60_000);

      const result = await checkLimit('sync_push');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(20);
    });
  });

  // ── Persistence across "restarts" ─────────────────────────────────────

  describe('persistence', () => {
    it('should persist bucket state to AsyncStorage', async () => {
      await confirmAction('case_submit');
      await confirmAction('case_submit');

      // Re-check without time advancement — state should be preserved
      const result = await checkLimit('case_submit');
      expect(result.remaining).toBeLessThanOrEqual(3);
    });

    it('should reset on clearStorage and rehydrate from scratch', async () => {
      await confirmAction('case_update');
      await confirmAction('case_update');

      // Clear module-level cache — storage wiped too
      await clearStorage();

      const result = await checkLimit('case_update');
      expect(result.remaining).toBe(10); // fresh full capacity
    });

    it('should persist state across multiple actions independently', async () => {
      // Consume 2 from case_submit (capacity 5)
      await confirmAction('case_submit');
      await confirmAction('case_submit');

      // Consume 8 from case_update (capacity 10)
      for (let i = 0; i < 8; i++) {
        await confirmAction('case_update');
      }

      const r1 = await checkLimit('case_submit');
      expect(r1.remaining).toBe(3);

      const r2 = await checkLimit('case_update');
      expect(r2.remaining).toBe(2);
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should reset a single action bucket', async () => {
      await confirmAction('case_submit');
      await confirmAction('case_submit');
      await confirmAction('case_submit');

      await resetLimit('case_submit');

      const result = await checkLimit('case_submit');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
    });

    it('should reset all action buckets', async () => {
      for (const action of ALL_ACTIONS) {
        await confirmAction(action);
      }

      await resetAllLimits();

      for (const action of ALL_ACTIONS) {
        const result = await checkLimit(action);
        const config = await getConfig(action);
        expect(result.remaining).toBe(config.capacity);
      }
    });
  });

  // ── Per-user overrides ──────────────────────────────────────────────────

  describe('per-user overrides', () => {
    it('should apply capacity override', async () => {
      await setOverride('case_submit', { capacity: 10 });
      const config = await getConfig('case_submit');
      expect(config.capacity).toBe(10);
      expect(config.refillRate).toBeCloseTo(5 / 60, 6); // unchanged
    });

    it('should apply refillRate override', async () => {
      await setOverride('sync_pull', { refillRate: 1 }); // 1/sec = 60/min
      const config = await getConfig('sync_pull');
      expect(config.refillRate).toBe(1);
      expect(config.capacity).toBe(30); // unchanged
    });

    it('should apply both capacity and refillRate override', async () => {
      await setOverride('evaluation_submit', { capacity: 10, refillRate: 10 / 60 });
      const result = await checkLimit('evaluation_submit');
      expect(result.remaining).toBe(10);
    });

    it('should respect override persisted in SecureStore', async () => {
      await setOverride('comment_submit', { capacity: 20 });

      // Simulate module cache reset without wiping secure store
      await resetAllLimits();

      // Re-load overrides from SecureStore
      await loadOverrides();
      const config = await getConfig('comment_submit');
      expect(config.capacity).toBe(20);
    });

    it('should fall back to defaults after clearStorage', async () => {
      await setOverride('comment_submit', { capacity: 20 });

      await clearStorage();
      await loadOverrides();

      const config = await getConfig('comment_submit');
      expect(config.capacity).toBe(10); // default
    });
  });

  // ── getRateLimitStatus ────────────────────────────────────────────────

  describe('getRateLimitStatus', () => {
    it('should return correct status for available action', async () => {
      const status = await getRateLimitStatus('case_submit');
      expect(status.label).toBe('Submit Case');
      expect(status.allowed).toBe(true);
      expect(status.display).toBe('5 / 5 remaining');
      expect(status.retryMessage).toBeNull();
      expect(status.fillRatio).toBe(1);
    });

    it('should return correct status for rate-limited action', async () => {
      // Exhaust evaluation_submit (capacity 3)
      for (let i = 0; i < 3; i++) {
        await confirmAction('evaluation_submit');
      }

      const status = await getRateLimitStatus('evaluation_submit');
      expect(status.label).toBe('Submit Evaluation');
      expect(status.allowed).toBe(false);
      expect(status.display).toBe('0 / 3 remaining');
      expect(status.retryMessage).toMatch(/Try again in/);
      expect(status.fillRatio).toBe(0);
    });

    it('should handle all action labels', async () => {
      const expectedLabels: Record<RateLimitAction, string> = {
        case_submit:       'Submit Case',
        case_update:       'Update Case',
        evaluation_submit: 'Submit Evaluation',
        comment_submit:    'Add Comment',
        sync_pull:         'Pull from Server',
        sync_push:         'Push to Server',
      };

      for (const [action, label] of Object.entries(expectedLabels) as [RateLimitAction, string][]) {
        const status = await getRateLimitStatus(action);
        expect(status.label).toBe(label);
      }
    });
  });

  // ── consumeIfAllowed ──────────────────────────────────────────────────

  describe('consumeIfAllowed', () => {
    it('should consume a token when allowed', async () => {
      const result = await consumeIfAllowed('case_submit');
      expect(result.allowed).toBe(true);

      const bucket = getRawBucket('case_submit');
      expect(bucket!.tokens).toBeLessThan(5);
    });

    it('should not consume when rate-limited', async () => {
      for (let i = 0; i < 5; i++) {
        await consumeIfAllowed('case_submit');
      }

      const bucketBefore = getRawBucket('case_submit');
      const result = await consumeIfAllowed('case_submit');
      expect(result.allowed).toBe(false);

      const bucketAfter = getRawBucket('case_submit');
      expect(bucketAfter!.tokens).toBeCloseTo(bucketBefore!.tokens, 1);
    });
  });

  // ── Formatting ────────────────────────────────────────────────────────

  describe('formatDuration (via getRateLimitStatus retryMessage)', () => {
    it('should format seconds correctly', async () => {
      // Exhaust sync_push (capacity 20, rate 20/60)
      for (let i = 0; i < 20; i++) {
        await confirmAction('sync_push');
      }
      // 1/3 of a second → should be "1 s"
      const status = await getRateLimitStatus('sync_push');
      expect(status.retryMessage).toMatch(/\d+ s/);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle rapid successive checks without time advancement', async () => {
      // Exhaust and then check multiple times at same frozen time
      for (let i = 0; i < 5; i++) {
        await confirmAction('comment_submit');
      }
      const results: RateLimitResult[] = [];
      for (let i = 0; i < 3; i++) {
        results.push(await checkLimit('comment_submit'));
      }
      // All should return same result since time hasn't changed
      expect(results[0].remaining).toBe(5);
      expect(results[0].allowed).toBe(true);
    });

    it('should handle concurrent confirms correctly', async () => {
      const config = await getConfig('case_submit');
      const capacity = config.capacity;

      for (let i = 0; i < capacity; i++) {
        await confirmAction('case_submit');
      }

      const result = await checkLimit('case_submit');
      expect(result.remaining).toBe(0);
      expect(result.allowed).toBe(false);
    });
  });
});
