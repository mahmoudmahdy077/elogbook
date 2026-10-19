import { randomUUID } from 'node:crypto';

const CORRELATION_HEADER = 'x-correlation-id';
const MIN_CORRELATION_LENGTH = 8;
const MAX_CORRELATION_LENGTH = 128;
const SAFE_CORRELATION_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DURATION_MS = 60_000;

export interface ClinicalCommandLogEntry {
  command: string;
  caseId: string;
  tenantId: string;
  durationMs: number;
  resultCode: string;
  correlationId: string;
}

export type ClinicalCommandLog = Readonly<Record<keyof ClinicalCommandLogEntry, string | number>>;

type HeaderSource = Headers | Record<string, string | string[] | undefined> | null | undefined;

function readHeader(source: HeaderSource, name: string): string | null {
  if (!source) return null;

  if (typeof (source as Headers).get === 'function') {
    return (source as Headers).get(name);
  }

  const record = source as Record<string, string | string[] | undefined>;
  const direct = record[name] ?? record[name.toLowerCase()];
  // A repeated header is ambiguous: different layers could resolve different
  // values. Fail closed and let the caller generate a fresh id instead.
  if (Array.isArray(direct)) return null;
  return direct ?? null;
}

export function isSafeCorrelationId(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < MIN_CORRELATION_LENGTH || value.length > MAX_CORRELATION_LENGTH) return false;
  return SAFE_CORRELATION_PATTERN.test(value);
}

export function resolveCorrelationId(source?: HeaderSource): string {
  const supplied = readHeader(source, CORRELATION_HEADER);
  if (isSafeCorrelationId(supplied)) return supplied;
  return randomUUID();
}

function boundedOpaqueId(value: unknown, pattern: RegExp): string {
  return typeof value === 'string' && pattern.test(value) ? value : 'unknown';
}

function boundedResultCode(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return 'unknown';
  return value.slice(0, 64);
}

function boundedDuration(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), MAX_DURATION_MS);
}

export function clinicalCommandLog(
  entry: ClinicalCommandLogEntry & Record<string, unknown>,
): ClinicalCommandLog {
  return Object.freeze({
    command: boundedOpaqueId(entry.command, /^[a-z_]{1,32}$/),
    caseId: boundedOpaqueId(entry.caseId, UUID_PATTERN),
    tenantId: boundedOpaqueId(entry.tenantId, UUID_PATTERN),
    durationMs: boundedDuration(entry.durationMs),
    resultCode: boundedResultCode(entry.resultCode),
    correlationId: isSafeCorrelationId(entry.correlationId) ? entry.correlationId : randomUUID(),
  });
}

export { CORRELATION_HEADER };

export function correlationHeaders(correlationId: string): Record<string, string> {
  const safe = isSafeCorrelationId(correlationId) ? correlationId : randomUUID();
  return { [CORRELATION_HEADER]: safe };
}
