export const RETRY_DELAYS_MS: readonly number[] = [30000, 60000, 120000, 300000];
export const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;
export const JITTER_MAX_MS = 30000;

export function computeRetryDelayMs(
  retryIndex: number,
  random: () => number = Math.random,
): number {
  const base = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
  const jitter = Math.floor(random() * JITTER_MAX_MS);
  return Math.min(base + jitter, MAX_RETRY_DELAY_MS);
}
