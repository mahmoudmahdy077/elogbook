/**
 * Structured logger with PHI redaction.
 *
 * Rules:
 *   - Emits one JSON line per call.
 *   - In Node, writes to stdout/stderr.
 *   - Recursively redacts known PHI keys in any object passed as `meta`.
 *
 * Never pass raw patient data as a log argument. The redactor is
 * defense-in-depth: callers should use the typed `logger.child({ tenantId })`
 * pattern and let the server do the joining.
 */

const PHI_KEYS = new Set([
  'patient_mrn',
  'patient_mrn_hash',
  'patient_dob',
  'patient_age_years',
  'patient_hash',
  'field_values',
  'mrn',
  'dob',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'api_key',
  'secret',
  'webhook_secret',
  'encrypted_api_key',
  'encrypted_secret_key',
  'encrypted_webhook_secret',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[redacted-depth]';
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PHI_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, meta: Record<string, unknown> = {}) {
  let requestId: string | undefined;
  let tenantId: string | undefined;
  let userId: string | undefined;
  try {
    const { requestContext } = require('./request-context') as typeof import('./request-context');
    requestId = requestContext.getRequestId();
    tenantId = requestContext.getTenantId();
    userId = requestContext.getUserId();
  } catch {
    /* request-context not available in some bundles */
  }
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(requestId ? { requestId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(userId ? { userId } : {}),
    ...(typeof window === 'undefined' && process?.pid ? { pid: process.pid } : {}),
    ...(redact(meta) as Record<string, unknown>),
  };
  const line = JSON.stringify(entry);

  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else if (typeof console !== 'undefined') {
    console.log(line);
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string | Error, meta?: Record<string, unknown>) => {
    const safeMeta = meta ?? {};
    if (msg instanceof Error) {
      emit('error', msg.message, { ...safeMeta, stack: msg.stack, name: msg.name });
    } else {
      emit('error', msg, safeMeta);
    }
  },
};

export { redact as redactPHI };
