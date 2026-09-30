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

  // Fail-closed MFA in production: DISABLE_MFA=true is local-dev only.
  // parseWebFullEnv also rejects this, this explicit guard gives a clear boot error.
  if (process.env.NODE_ENV === 'production' && process.env.DISABLE_MFA === 'true') {
    throw new Error(
      '[env/web-full] Validation failed:\n  DISABLE_MFA: DISABLE_MFA=true is forbidden in production.',
    );
  }

  const { parseSetupEnv, parseWebFullEnv } = await import('@elogbook/env');
  const setupMode = process.env.SETUP_MODE;
  const setupRequested = setupMode === 'true'
    || (setupMode !== undefined && setupMode !== 'false')
    || process.env.SETUP_PHASE !== undefined
    || process.env.SETUP_BIND_ADDRESS !== undefined
    || process.env.SETUP_REMOTE_TLS_REQUIRED !== undefined;
  if (setupRequested) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[env/setup] Setup mode cannot run with NODE_ENV=production');
    }
    if (process.env.SETUP_MODE !== 'true' || process.env.SETUP_PHASE !== 'setup') {
      throw new Error('[env/setup] SETUP_MODE=true and SETUP_PHASE=setup are required together');
    }
    parseSetupEnv(process.env as Record<string, string | undefined>);
    return;
  }

  parseWebFullEnv(process.env as Record<string, string | undefined>);

  // Validate and memoise the rate-limit mode; logs the startup warning for
  // single-instance-with-creds and will throw for invalid values.
  const { resolveMode } = await import('@/lib/rate-limit-redis');
  resolveMode();
}

export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string; revalidateReason?: string; renderType?: string },
): Promise<void> {
  if (typeof window !== 'undefined') return;
  const { createEventId } = await import('./lib/observability/redact');
  const { logger } = await import('./lib/logger');
  const eventId = createEventId('next.request_error', {
    path: request.path?.split('?')[0] ?? 'unknown',
    method: request.method ?? 'UNKNOWN',
    routeType: context.routeType,
  });
  const safeContext = {
    eventId,
    route: request.path?.split('?')[0] ?? 'unknown',
    method: request.method ?? 'UNKNOWN',
    routerKind: context.routerKind,
    routeType: context.routeType,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
    renderType: context.renderType,
  };
  if (error instanceof Error) {
    logger.error('next.request_error', error, safeContext);
  } else {
    logger.error('next.request_error', safeContext);
  }
}
