/**
 * Node-only boot validation for the Next.js instrumentation hook.
 *
 * This module is imported from `instrumentation.ts` only when
 * `process.env.NEXT_RUNTIME === 'nodejs'`. Keeping it separate means the Edge
 * runtime variant of the instrumentation bundle never sees Node built-ins or
 * `process.exit`, which is what Turbopack warned about ("A Node.js API is used
 * (process.exit ...) which is not supported in the Edge Runtime").
 *
 * Behaviour is unchanged: the validation still runs once at server boot and a
 * failure still terminates the process before any request is served (Gate C).
 */

export async function registerNode(): Promise<void> {
  try {
    // Validate the full env schema — throws if RATE_LIMIT_MODE missing in prod
    // or if distributed mode lacks Upstash credentials.
    const { parseWebFullEnv } = await import('@elogbook/env');
    parseWebFullEnv(process.env as Record<string, string | undefined>);

    // Validate and memoise the rate-limit mode; logs the startup warning for
    // single-instance-with-creds and will throw for invalid values.
    const { resolveMode } = await import('@/lib/rate-limit-redis');
    resolveMode();
  } catch (err) {
    // Next.js 16 does NOT exit the process when the instrumentation hook
    // throws — it logs uncaughtException/unhandledRejection and keeps the
    // (broken) server alive. Gate C requires a non-zero exit before any
    // traffic is accepted, so exit here instead of returning to Next.
    console.error('[boot] fatal: deployment contract validation failed. Exiting.');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
