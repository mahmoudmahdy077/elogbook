/**
 * Next.js instrumentation hook — runs once when the server boots, before
 * handling any request. This is the ONLY place that validates the deployment
 * contract at startup, per D-11.
 *
 * Required by TICKET-001 §V:
 *  - parseWebFullEnv(process.env) validates RATE_LIMIT_MODE (and Upstash creds when distributed)
 *  - resolveMode() memoises the mode, validates Upstash presence, and logs the
 *    single-instance-with-creds warning. Calling it here makes the warning
 *    appear at boot, not on first request, and makes a missing RATE_LIMIT_MODE
 *    in production fail the process (non-zero exit) rather than serving 500s.
 *
 * Gate C asserts the process exits non-zero when RATE_LIMIT_MODE is unset in
 * production. That is verified by observing the exit code, not by reading code.
 */

export async function register() {
  // Only run on the server (Next calls this in both edge and node runtimes)
  if (typeof window !== 'undefined') return;

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
