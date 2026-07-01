/**
 * Performance instrumentation for React Native.
 *
 * Target: Case logging completion < 60s, sync completion < 30s
 */

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const metrics: PerformanceMetric[] = [];
const MAX_METRICS = 500;

/**
 * Measure an async operation.
 */
export async function measureAsync<T>(
  name: string,
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
    const threshold = options?.slowThreshold ?? 1000;

    recordMetric({
      name,
      duration,
      timestamp: new Date().toISOString(),
    });

    if (options?.logSlow !== false && duration > threshold) {
      console.warn(`Slow operation: ${name} took ${duration.toFixed(0)}ms`);
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
      name,
      duration,
      timestamp: new Date().toISOString(),
      metadata,
    });
    return duration;
  };
}

/**
 * Measure case logging flow (target: < 60 seconds).
 */
export async function measureCaseLogging<T>(fn: () => Promise<T>): Promise<T> {
  return measureAsync('case_logging', fn, { slowThreshold: 60000 });
}

/**
 * Measure sync operation (target: < 30 seconds).
 */
export async function measureSync<T>(fn: () => Promise<T>): Promise<T> {
  return measureAsync('sync', fn, { slowThreshold: 30000 });
}

/**
 * Get all recorded metrics.
 */
export function getMetrics(): readonly PerformanceMetric[] {
  return metrics;
}

/**
 * Clear all metrics.
 */
export function clearMetrics(): void {
  metrics.length = 0;
}

/**
 * Get summary statistics.
 */
export function getMetricStats(pattern: string): {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
  min: number;
} {
  const matched = metrics.filter(m => m.name.includes(pattern));
  if (matched.length === 0) {
    return { count: 0, avg: 0, p50: 0, p95: 0, max: 0, min: 0 };
  }

  const durations = matched.map(m => m.duration).sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);

  return {
    count: durations.length,
    avg: sum / durations.length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
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
