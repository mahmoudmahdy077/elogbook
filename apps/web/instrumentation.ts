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
 *
 * The Node-only work lives in `instrumentation-node.ts` and is imported only
 * for the nodejs runtime, so the Edge variant of this bundle never contains
 * `process.exit` (Turbopack build warning) while behaviour is unchanged.
 */

export async function register() {
  // Next calls this hook in both the edge and node runtimes. Only the node
  // runtime has the environment contract (and the ability to exit the process).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { registerNode } = await import('./instrumentation-node');
  await registerNode();
}
