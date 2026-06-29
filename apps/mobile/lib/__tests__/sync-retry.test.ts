import { describe, it, expect } from 'vitest';
import { computeRetryDelayMs, MAX_RETRY_DELAY_MS, RETRY_DELAYS_MS, JITTER_MAX_MS } from '../sync-retry';

describe('computeRetryDelayMs', () => {
  it('returns base delay when jitter is 0', () => {
    expect(computeRetryDelayMs(0, () => 0)).toBe(RETRY_DELAYS_MS[0]);
    expect(computeRetryDelayMs(1, () => 0)).toBe(RETRY_DELAYS_MS[1]);
    expect(computeRetryDelayMs(2, () => 0)).toBe(RETRY_DELAYS_MS[2]);
    expect(computeRetryDelayMs(3, () => 0)).toBe(RETRY_DELAYS_MS[3]);
  });

  it('returns base + jitter when random is in range', () => {
    expect(computeRetryDelayMs(0, () => 0.5)).toBe(RETRY_DELAYS_MS[0] + Math.floor(0.5 * JITTER_MAX_MS));
  });

  it('caps at MAX_RETRY_DELAY_MS even when jitter is large', () => {
    expect(computeRetryDelayMs(3, () => 1)).toBe(MAX_RETRY_DELAY_MS);
  });

  it('uses the last bucket when retry index is beyond the table', () => {
    expect(computeRetryDelayMs(99, () => 0)).toBe(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
  });
});
