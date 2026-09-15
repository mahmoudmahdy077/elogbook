/**
 * M5/P2 — allowlisted redacted logger. The ONLY approved console sink.
 *
 * - Structured `[level] eventId extra` lines; eventId is a stable string
 *   (e.g. 'sync.flush') so CI can allowlist expected operational events.
 * - Extras are scrubbed: PHI values, tokens, raw URLs, ciphertext, and
 *   attachment paths never reach logs (nor Sentry/analytics/breadcrumbs —
 *   route those payloads through scrubTelemetry/redactUri first).
 * - Info/debug are silent in production; warn/error always emit.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const REDACTED = '[redacted]';

// Keys whose VALUES are always redacted (case-insensitive substring match).
const SENSITIVE_KEY_PARTS = [
  'mrn',
  'dob',
  'ssn',
  'patient',
  'token',
  'secret',
  'password',
  'apikey',
  'api_key',
  'auth',
  'cipher',
  'field_values',
  'fieldvalues',
  'photo',
  'attachment',
  'file_path',
  'filepath',
  'uri',
  'url',
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Query strings / bearer material inside free text.
    if (/[?&](token|apikey|api_key|secret|signature)=/i.test(value) || /Bearer\s+[A-Za-z0-9\-._~+/=]+/.test(value)) {
      return REDACTED;
    }
    // Long hex/blob strings (ciphertext, hashes) are never log-safe.
    if (/^[0-9a-f]{64,}$/i.test(value.trim())) return REDACTED;
    return value;
  }
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : scrubValue(v);
    }
    return out;
  }
  return value;
}

function scrubExtras(extra: Record<string, unknown>): Record<string, unknown> {
  return scrubValue(extra) as Record<string, unknown>;
}

export function isLogEnabled(level: LogLevel, env = process.env.NODE_ENV ?? 'development'): boolean {
  if (env === 'production') return level === 'warn' || level === 'error';
  return true;
}

function emit(level: LogLevel, eventId: string, extra?: Record<string, unknown>): void {
  if (!isLogEnabled(level)) return;
  const clean = extra ? scrubExtras(extra) : undefined;
  const sink =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.debug;
  if (clean === undefined) sink(`[${level}] ${eventId}`);
  else sink(`[${level}] ${eventId}`, clean);
}

export function logInfo(eventId: string, extra?: Record<string, unknown>): void {
  emit('info', eventId, extra);
}

export function logWarn(eventId: string, extra?: Record<string, unknown>): void {
  emit('warn', eventId, extra);
}

export function logError(eventId: string, err?: unknown, extra?: Record<string, unknown>): void {
  const base = err instanceof Error ? { message: err.message } : err !== undefined ? { error: String(err) } : {};
  emit('error', eventId, { ...scrubExtras(base as Record<string, unknown>), ...scrubExtras(extra ?? {}) });
}
