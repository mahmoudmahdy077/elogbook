/**
 * M5 — redacted structured telemetry (local-first).
 *
 * Allowed: queue depth, latency, retry class, conflict count, data mode,
 * app version, policy version. NEVER: patient values, tokens, raw URLs,
 * form payloads, ciphertext, drafts. scrubTelemetry() is the single
 * choke point before any log/Sentry/analytics/crash/notification path.
 */

export type RetryClass = 'transient' | 'auth' | 'policy' | 'validation' | 'conflict' | 'tamper' | 'unknown' | 'none';

export interface SyncTelemetry {
  queueDepth: number;
  latencyMs: number;
  retryClass: RetryClass;
  conflicts: number;
  dataMode: 'deidentified' | 'identifiable' | 'unknown';
  appVersion: string;
  policyVersion: number;
}

const ALLOWED_KEYS = new Set([
  'queueDepth',
  'latencyMs',
  'retryClass',
  'conflicts',
  'dataMode',
  'appVersion',
  'policyVersion',
]);

export function buildSyncTelemetry(input: SyncTelemetry): SyncTelemetry {
  return {
    queueDepth: Math.max(0, Math.floor(input.queueDepth)),
    latencyMs: Math.max(0, Math.floor(input.latencyMs)),
    retryClass: input.retryClass,
    conflicts: Math.max(0, Math.floor(input.conflicts)),
    dataMode: input.dataMode,
    appVersion: String(input.appVersion).slice(0, 32),
    policyVersion: Math.max(0, Math.floor(input.policyVersion)),
  };
}

/** Allowlist-scrub any object before telemetry/logging. Drops everything not in the contract. */
export function scrubTelemetry<T extends object>(raw: T): Partial<SyncTelemetry> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw as Record<string, unknown>)) {
    if (ALLOWED_KEYS.has(k)) out[k] = (raw as Record<string, unknown>)[k];
  }
  return out as Partial<SyncTelemetry>;
}

const DENY_KEY_PARTS = [
  'mrn', 'dob', 'ssn', 'patient', 'token', 'secret', 'password', 'apikey', 'api_key',
  'auth', 'cipher', 'field_values', 'fieldvalues', 'photo', 'attachment', 'file_path',
  'filepath', 'uri', 'url', 'email', 'phone',
];

function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  return DENY_KEY_PARTS.some((part) => k.includes(part));
}

function scrubDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/[?&](token|apikey|api_key|secret|signature)=/i.test(value) || /Bearer\s+[A-Za-z0-9\-._~+/=]+/.test(value)) {
      return '[redacted]';
    }
    if (/^[0-9a-f]{64,}$/i.test(value.trim())) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isDeniedKey(k) ? '[redacted]' : scrubDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * Denylist-scrub arbitrary analytics event properties (M5.3).
 * Drops PHI/token/URL/ciphertext/path KEYS (values replaced, structure kept
 * for debugging) and redacts token-bearing / blob-like string values.
 * Prefer the sync-telemetry allowlist for new events; this is the choke
 * point for legacy producers (PostHog event queue, notifications).
 */
export function scrubEventProperties<T extends Record<string, unknown>>(props: T): T {
  return scrubDeep(props) as T;
}
