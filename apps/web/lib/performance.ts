/**
 * Performance instrumentation for API and page load measurements.
 *
 * Target: p95 response time < 500ms for 5K concurrent users
 */

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const metrics: PerformanceMetric[] = [];
const MAX_METRICS = 1000;

/**
 * Measure an API call duration and optionally log slow calls.
 */
export async function measureApiCall<T>(
  endpoint: string,
  fn: () => Promise<T>,
  options?: {
    logSlow?: boolean;
    slowThreshold?: number;
  }
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - start;
    const threshold = options?.slowThreshold ?? 500;

    recordMetric({
      name: `api:${endpoint}`,
      duration,
      timestamp: new Date().toISOString(),
    });

    if (options?.logSlow !== false && duration > threshold) {
      console.warn(`Slow API call: ${endpoint} took ${duration.toFixed(0)}ms`);
    }
  }
}

/**
 * Measure a synchronous operation.
 */
export function measureSync<T>(
  name: string,
  fn: () => T,
  options?: { logSlow?: boolean; slowThreshold?: number }
): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const duration = performance.now() - start;
    const threshold = options?.slowThreshold ?? 100;

    recordMetric({
      name: `sync:${name}`,
      duration,
      timestamp: new Date().toISOString(),
    });

    if (options?.logSlow !== false && duration > threshold) {
      console.warn(`Slow sync operation: ${name} took ${duration.toFixed(0)}ms`);
    }
  }
}

/**
 * Create a timer that can be stopped later.
 */
export function startTimer(name: string, metadata?: Record<string, unknown>): () => number {
  const start = performance.now();

  return () => {
    const duration = performance.now() - start;
    recordMetric({
      name: `timer:${name}`,
      duration,
      timestamp: new Date().toISOString(),
      metadata,
    });
    return duration;
  };
}

/**
 * Get all recorded metrics (for reporting).
 */
export function getMetrics(): readonly PerformanceMetric[] {
  return metrics;
}

/**
 * Clear all recorded metrics.
 */
export function clearMetrics(): void {
  metrics.length = 0;
}

/**
 * Get summary statistics for a metric pattern.
 */
export function getMetricStats(pattern: string): {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
} {
  const matched = metrics.filter(m => m.name.includes(pattern));
  if (matched.length === 0) {
    return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  }

  const durations = matched.map(m => m.duration).sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);

  return {
    count: durations.length,
    avg: sum / durations.length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: Math.max(...durations),
    min: Math.min(...durations),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function recordMetric(metric: PerformanceMetric): void {
  metrics.push(metric);
  if (metrics.length > MAX_METRICS) {
    metrics.shift();
  }
}

/**
 * Report metrics to external monitoring (e.g., via sendBeacon).
 */
export function reportMetrics(): void {
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  if (metrics.length === 0) return;

  const payload = {
    type: 'performance-metrics',
    metrics: metrics.slice(-50),
    timestamp: new Date().toISOString(),
  };

  try {
    navigator.sendBeacon('/api/metrics', JSON.stringify(payload));
  } catch {
    // Best-effort reporting
  }
}

// Auto-report on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', reportMetrics);
}
