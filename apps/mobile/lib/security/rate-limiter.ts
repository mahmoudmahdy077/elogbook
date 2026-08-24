// Token-bucket rate limiter for write operations.
//
// Each *action* gets its own bucket with a configurable capacity (max tokens)
// and refill rate (tokens per second).  State is persisted to AsyncStorage so
// it survives app restarts, and per-user overrides are read from SecureStore.
//
// Usage:
//   const result = await checkLimit('case_submit');
//   if (result.allowed) {
//     await submitCase(payload);
//     await confirmAction('case_submit');   // resets the bucket
//   } else {
//     showRetryToast(result.retryAfterMs);
//   }

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSecureItem, setSecureItem } from '../secure-store';

// ── Types ────────────────────────────────────────────────────────────────────

/** Supported action identifiers. */
export type RateLimitAction =
  | 'case_submit'
  | 'case_update'
  | 'evaluation_submit'
  | 'comment_submit'
  | 'sync_pull'
  | 'sync_push';

/** Shape of a single bucket persisted to storage. */
export interface BucketState {
  /** Tokens currently in the bucket. */
  tokens: number;
  /** ISO timestamp of the last refill / consumption. */
  lastRefill: string;
}

/** Configuration for one rate limit. */
export interface RateLimitConfig {
  /** Maximum tokens (burst capacity). */
  capacity: number;
  /** Tokens restored per second. */
  refillRate: number;
}

/** Result returned by `checkLimit`. */
export interface RateLimitResult {
  /** Whether the action is allowed right now. */
  allowed: boolean;
  /** How many more requests can be made before hitting the limit. */
  remaining: number;
  /** Milliseconds until one token becomes available (0 if allowed). */
  retryAfterMs: number;
}

/** Human-readable status for UI rendering. */
export interface RateLimitStatus {
  /** Friendly action label, e.g. "Submit Case". */
  label: string;
  /** Remaining uses display string, e.g. "3 / 5 remaining". */
  display: string;
  /** Whether the action is currently allowed. */
  allowed: boolean;
  /** When retry is needed, a human string like "Try again in 12 s". */
  retryMessage: string | null;
  /** Fraction of capacity remaining (0-1). Useful for progress bars. */
  fillRatio: number;
}

/** Override shape stored in SecureStore (JSON stringified). */
export type PerUserOverrides = {
  [key: string]: Partial<RateLimitConfig> | undefined;
};

// ── Default limits (per minute) ──────────────────────────────────────────────

const DEFAULT_LIMITS: Record<RateLimitAction, RateLimitConfig> = {
  case_submit:        { capacity: 5,  refillRate: 5 / 60 },
  case_update:        { capacity: 10, refillRate: 10 / 60 },
  evaluation_submit:  { capacity: 3,  refillRate: 3 / 60 },
  comment_submit:     { capacity: 10, refillRate: 10 / 60 },
  sync_pull:          { capacity: 30, refillRate: 30 / 60 },
  sync_push:          { capacity: 20, refillRate: 20 / 60 },
};

/** Human-friendly labels for each action. */
const ACTION_LABELS: Record<RateLimitAction, string> = {
  case_submit:       'Submit Case',
  case_update:       'Update Case',
  evaluation_submit: 'Submit Evaluation',
  comment_submit:    'Add Comment',
  sync_pull:         'Pull from Server',
  sync_push:         'Push to Server',
};

// ── Storage keys ─────────────────────────────────────────────────────────────

const ASYNC_STORAGE_PREFIX = '@elogbook/ratelimit:';
const SECURE_STORE_KEY = '@elogbook/ratelimit_overrides';

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Read the persisted bucket state for an action.
 * Returns `null` when no prior state exists.
 */
async function readBucket(action: RateLimitAction): Promise<BucketState | null> {
  try {
    const raw = await AsyncStorage.getItem(`${ASYNC_STORAGE_PREFIX}${action}`);
    if (!raw) return null;
    return JSON.parse(raw) as BucketState;
  } catch {
    return null;
  }
}

/** Persist bucket state to AsyncStorage. */
async function writeBucket(action: RateLimitAction, state: BucketState): Promise<void> {
  try {
    await AsyncStorage.setItem(`${ASYNC_STORAGE_PREFIX}${action}`, JSON.stringify(state));
  } catch {
    // Best-effort persistence — proceed even if storage fails.
  }
}

/** Remove a bucket from AsyncStorage (used during reset). */
async function removeBucket(action: RateLimitAction): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${ASYNC_STORAGE_PREFIX}${action}`);
  } catch {
    // Silently ignore.
  }
}

/**
 * Apply per-user overrides (read from SecureStore) to the default config.
 * Results are cached for the lifetime of the module so SecureStore is only
 * read once per import (callers can invoke `loadOverrides()` to force a
 * refresh).
 */
let cachedOverrides: PerUserOverrides | null = null;
let overridesLoaded = false;

export async function loadOverrides(): Promise<PerUserOverrides> {
  try {
    const raw = await getSecureItem(SECURE_STORE_KEY);
    if (raw) {
      cachedOverrides = JSON.parse(raw) as PerUserOverrides;
    } else {
      cachedOverrides = {};
    }
  } catch {
    cachedOverrides = {};
  }
  overridesLoaded = true;
  return cachedOverrides;
}

export async function setOverride(
  action: RateLimitAction,
  override: Partial<RateLimitConfig>,
): Promise<void> {
  const current = cachedOverrides ?? (await loadOverrides());
  current[action] = { ...(current[action] as Partial<RateLimitConfig>), ...override };
  cachedOverrides = current;
  await setSecureItem(SECURE_STORE_KEY, JSON.stringify(current));
}

/** Resolve effective config for an action (default merged with overrides). */
export async function getConfig(
  action: RateLimitAction,
): Promise<RateLimitConfig> {
  if (!overridesLoaded) await loadOverrides();
  const base = DEFAULT_LIMITS[action];
  const override = cachedOverrides?.[action] as Partial<RateLimitConfig> | undefined;
  return { ...base, ...override };
}

/**
 * Refill tokens based on elapsed time since `lastRefill`.
 * Returns the new (clamped) token count.
 */
function refill(state: BucketState, capacity: number, refillRate: number, now: number): number {
  const elapsed = (now - new Date(state.lastRefill).getTime()) / 1000; // seconds
  if (elapsed <= 0) return state.tokens;
  return Math.min(capacity, state.tokens + elapsed * refillRate);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether `action` is allowed right now.
 *
 * This does **not** consume a token — call `confirmAction` after a successful
 * operation to reset / consume.
 */
export async function checkLimit(action: RateLimitAction): Promise<RateLimitResult> {
  const config = await getConfig(action);
  const now = Date.now();
  const bucket = await readBucket(action);

  if (!bucket) {
    // First request for this action — full bucket.
    return { allowed: true, remaining: config.capacity, retryAfterMs: 0 };
  }

  const currentTokens = refill(bucket, config.capacity, config.refillRate, now);
  const remaining = Math.floor(currentTokens);

  if (remaining >= 1) {
    return { allowed: true, remaining, retryAfterMs: 0 };
  }

  // Calculate time until the next token arrives.
  const deficit = 1 - currentTokens; // fractional tokens needed
  const retryAfterMs = Math.ceil((deficit / config.refillRate) * 1000);

  return { allowed: false, remaining: 0, retryAfterMs };
}

/**
 * Record a successful action — consumes one token and persists the new state.
 */
export async function confirmAction(action: RateLimitAction): Promise<void> {
  const config = await getConfig(action);
  const now = Date.now();
  const bucket = await readBucket(action);

  let currentTokens: number;
  if (!bucket) {
    currentTokens = config.capacity;
  } else {
    currentTokens = refill(bucket, config.capacity, config.refillRate, now);
  }

  const newTokens = Math.max(0, currentTokens - 1);
  const state: BucketState = { tokens: newTokens, lastRefill: new Date(now).toISOString() };
  await writeBucket(action, state);
}

/**
 * Reset a single action's bucket back to full capacity.
 */
export async function resetLimit(action: RateLimitAction): Promise<void> {
  await removeBucket(action);
}

/**
 * Reset all buckets to full capacity.
 */
export async function resetAllLimits(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const targets = keys.filter((k) => k.startsWith(ASYNC_STORAGE_PREFIX));
  if (targets.length > 0) {
    await AsyncStorage.removeMany(targets);
  }
}

/**
 * Return human-readable rate-limit status for the UI.
 */
export async function getRateLimitStatus(
  action: RateLimitAction,
): Promise<RateLimitStatus> {
  const config = await getConfig(action);
  const result = await checkLimit(action);

  const label = ACTION_LABELS[action] ?? action;
  const display = `${result.remaining} / ${config.capacity} remaining`;
  const retryMessage = result.allowed
    ? null
    : `Try again in ${formatDuration(result.retryAfterMs)}`;
  const fillRatio = result.remaining / config.capacity;

  return { label, display, allowed: result.allowed, retryMessage, fillRatio };
}

// ── Formatting utility ───────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec} s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min} min ${sec} s` : `${min} min`;
}

// ── Utility: check before performing any operation in a single call ──────────

/**
 * Convenience wrapper: check the limit, and if allowed, immediately consume
 * a token.  Returns the result so callers know whether the action proceeded.
 *
 * Use this when the caller trusts the operation will succeed (fire-and-forget).
 * For operations where you need to confirm after success, use `checkLimit` +
 * `confirmAction` separately.
 */
export async function consumeIfAllowed(
  action: RateLimitAction,
): Promise<RateLimitResult> {
  const result = await checkLimit(action);
  if (result.allowed) {
    await confirmAction(action);
  }
  return result;
}

// ── Reset storage (test helper) ──────────────────────────────────────────────

/**
 * Clear ALL rate limiter storage (buckets + overrides).  Exposed for testing.
 */
export async function clearStorage(): Promise<void> {
  await resetAllLimits();
  await setSecureItem(SECURE_STORE_KEY, '');
  cachedOverrides = null;
  overridesLoaded = false;
}
