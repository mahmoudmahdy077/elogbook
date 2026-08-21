/**
 * Telemetry & Monitoring for Production.
 *
 * Cycle 7: PostHog events, sync health metrics, error tracking integration.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// 1. Event Tracking (PostHog-compatible)
// ---------------------------------------------------------------------------

export interface TelemetryEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: number;
  userId?: string;
  sessionId: string;
}

const EVENT_QUEUE_KEY = 'telemetry_events_v1';
const MAX_QUEUE_SIZE = 200;
const SESSION_ID_KEY = 'telemetry_session_id';

let currentSessionId = '';
let currentUserId: string | null = null;

/**
 * Initialize telemetry with user context.
 */
export function initTelemetry(userId: string): void {
  currentUserId = userId;
  currentSessionId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Track a named event with properties.
 */
export async function trackEvent(
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const entry: TelemetryEvent = {
    event,
    properties: {
      ...properties,
      platform: 'mobile',
      app_version: '2.0.0',
    },
    timestamp: Date.now(),
    userId: currentUserId ?? undefined,
    sessionId: currentSessionId,
  };

  const queue = await loadEventQueue();
  queue.push(entry);
  if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  await AsyncStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(queue));
}

// ---------------------------------------------------------------------------
// 2. Pre-defined Medical App Events
// ---------------------------------------------------------------------------

/** Track case creation (with PHI-safe properties only) */
export async function trackCaseCreated(templateId: string, isDeidentified: boolean): Promise<void> {
  await trackEvent('case_created', { template_id: templateId, deidentified: isDeidentified });
}

/** Track case submission for approval */
export async function trackCaseSubmitted(caseId: string): Promise<void> {
  await trackEvent('case_submitted', { case_id: caseId });
}

/** Track evaluation creation */
export async function trackEvaluationCreated(formType: string): Promise<void> {
  await trackEvent('evaluation_created', { form_type: formType });
}

/** Track sync performance */
export async function trackSyncComplete(
  pulled: number,
  pushed: number,
  durationMs: number,
  errors: number,
): Promise<void> {
  await trackEvent('sync_complete', { pulled, pushed, duration_ms: durationMs, errors });
}

/** Track sync failure */
export async function trackSyncError(table: string, error: string, phase: string): Promise<void> {
  await trackEvent('sync_error', { table, error: error.slice(0, 200), phase });
}

/** Track offline mode usage */
export async function trackOfflineWrite(table: string, operation: string): Promise<void> {
  await trackEvent('offline_write', { table, operation });
}

/** Track biometric auth */
export async function trackBiometricAuth(success: boolean, method: string): Promise<void> {
  await trackEvent('biometric_auth', { success, method });
}

/** Track app lifecycle */
export async function trackAppForeground(): Promise<void> {
  await trackEvent('app_foreground');
}

export async function trackAppBackground(): Promise<void> {
  await trackEvent('app_background');
}

// ---------------------------------------------------------------------------
// 3. Sync Health Metrics
// ---------------------------------------------------------------------------

const METRICS_KEY = 'sync_metrics_v1';

export interface SyncMetrics {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalPulled: number;
  totalPushed: number;
  totalConflicts: number;
  avgSyncDurationMs: number;
  lastSyncAt: number | null;
  lastSyncDurationMs: number | null;
  lastSyncErrors: string[];
}

async function loadMetrics(): Promise<SyncMetrics> {
  try {
    const raw = await AsyncStorage.getItem(METRICS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    totalSyncs: 0, successfulSyncs: 0, failedSyncs: 0,
    totalPulled: 0, totalPushed: 0, totalConflicts: 0,
    avgSyncDurationMs: 0, lastSyncAt: null, lastSyncDurationMs: null,
    lastSyncErrors: [],
  };
}

/**
 * Record a sync completion (success or failure).
 */
export async function recordSyncResult(result: {
  success: boolean;
  pulled: number;
  pushed: number;
  conflicts: number;
  durationMs: number;
  errors: string[];
}): Promise<void> {
  const m = await loadMetrics();
  m.totalSyncs++;
  if (result.success) m.successfulSyncs++;
  else m.failedSyncs++;
  m.totalPulled += result.pulled;
  m.totalPushed += result.pushed;
  m.totalConflicts += result.conflicts;
  m.avgSyncDurationMs = (m.avgSyncDurationMs * (m.totalSyncs - 1) + result.durationMs) / m.totalSyncs;
  m.lastSyncAt = Date.now();
  m.lastSyncDurationMs = result.durationMs;
  m.lastSyncErrors = result.errors.slice(0, 5);
  await AsyncStorage.setItem(METRICS_KEY, JSON.stringify(m));
}

/**
 * Get current sync health metrics.
 */
export async function getSyncMetrics(): Promise<SyncMetrics> {
  return loadMetrics();
}

/**
 * Check if sync health is degraded (failure rate > 30%).
 */
export async function isSyncHealthy(): Promise<boolean> {
  const m = await loadMetrics();
  if (m.totalSyncs < 3) return true; // not enough data
  return m.failedSyncs / m.totalSyncs < 0.3;
}

// ---------------------------------------------------------------------------
// 4. Event Queue Flush
// ---------------------------------------------------------------------------

async function loadEventQueue(): Promise<TelemetryEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(EVENT_QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
}

/**
 * Export the event queue for batch sending to analytics endpoint.
 * Returns the events and clears the local queue.
 */
export async function flushEventQueue(): Promise<TelemetryEvent[]> {
  const queue = await loadEventQueue();
  if (queue.length === 0) return [];
  await AsyncStorage.removeItem(EVENT_QUEUE_KEY);
  return queue;
}

/**
 * Get queue size without flushing.
 */
export async function getEventQueueSize(): Promise<number> {
  const queue = await loadEventQueue();
  return queue.length;
}
