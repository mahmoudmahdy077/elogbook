import { after } from 'next/server';
import { logger } from '@/lib/logger';

export interface AfterResponseOptions {
  /** Short, stable label used in the structured log line. */
  label: string;
  /** Receives the failure so a caller can record it durably. */
  onError?: (error: unknown) => void;
}

/**
 * Schedule post-response work durably.
 *
 * A bare `void somePromise()` in a route handler is frozen the moment the
 * response returns on serverless, which silently dropped webhook deliveries in
 * production. `after()` keeps the task alive past the response; this wrapper
 * additionally guarantees the returned promise is never dropped, and funnels
 * every failure (sync throw, rejected promise, or a thrown `after()`) into a
 * single reported path instead of an unhandled rejection.
 */
export function runAfterResponse(
  task: () => unknown | Promise<unknown>,
  { label, onError }: AfterResponseOptions,
): void {
  const report = (error: unknown) => {
    try {
      onError?.(error);
    } catch (reportingError) {
      logger.error('after-response error reporting failed', reportingError, { label });
    }
    logger.error('after-response task failed', error instanceof Error ? error : new Error('after-response task failed'), { label });
  };

  const guarded = () => {
    try {
      const result = task();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).catch(report);
      }
    } catch (error) {
      report(error);
    }
  };

  try {
    after(guarded);
  } catch {
    // `after()` throws outside a request scope (e.g. a background invocation).
    // Await the work inline rather than dropping it.
    logger.warn('after() unavailable; running task inline', { label });
    guarded();
  }
}
