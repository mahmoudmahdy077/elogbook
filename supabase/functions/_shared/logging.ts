const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;
const MAX_BYTES = 16_384;
const MAX_ITEMS = 50;
const MAX_STRING = 512;

type RecordValue = Record<string, unknown>;

const SAFE_KEYS = new Set([
  'action', 'category', 'code', 'component', 'context', 'correlationid', 'count', 'costcents', 'durationms', 'environment', 'error', 'event', 'eventid', 'fingerprint', 'id', 'index', 'inputtokens', 'latencyms', 'level', 'method', 'model', 'operation', 'operationid', 'phase', 'platform', 'provider', 'reason', 'release', 'requestid', 'responseid', 'route', 'severity', 'source', 'status', 'statuscode', 'tenantid', 'timestamp', 'total', 'totaltokens', 'transaction', 'ts', 'type', 'url', 'usage', 'version',
]);

const OPERATIONAL_KEYS = new Set(['id', 'responseid', 'requestid', 'eventid', 'correlationid', 'count', 'index', 'status', 'statuscode', 'total', 'totaltokens', 'inputtokens', 'outputtokens', 'costcents', 'durationms', 'latencyms', 'model', 'provider', 'category', 'type', 'level', 'method', 'route', 'action', 'component', 'operation', 'operationid', 'phase', 'severity', 'source', 'version']);

const SAFE_HEADERS = new Set(['accept', 'contentlength', 'contenttype', 'useragent']);
const RAW_BODY_KEYS = new Set(['body', 'data', 'field_values', 'fieldvalues', 'input', 'messages', 'payload', 'prompt', 'requestbody', 'request_body', 'responsebody', 'response_body', 'responsetext', 'response_text', 'rawbody', 'raw_body', 'stream']);
const SENSITIVE_PARTS = ['authorization', 'cookie', 'setcookie', 'credential', 'password', 'passphrase', 'token', 'apikey', 'secret', 'privatekey', 'webhooksecret', 'mrn', 'dob', 'dateofbirth', 'birthdate', 'ssn', 'patienthash', 'fieldvalues', 'phi', 'email', 'mail', 'phone', 'address', 'encrypted'];
const SENSITIVE_NAMES = new Set(['mrn', 'ssn', 'dob', 'name', 'fullname', 'firstname', 'lastname', 'message', 'patient', 'patientid', 'residentname', 'reviewername', 'displayname', 'username', 'user', 'cookies', 'cookie', 'authorization', 'accesstoken', 'refreshtoken', 'idtoken', 'clientsecret', 'apikey', 'secret', 'password', 'fieldvalues', 'patientmrn', 'patientdob', 'patienthash', 'email', 'emailaddress']);
const VALUE_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:mrn|medical\s+record(?:\s+number)?|patient\s+mrn)\s*[:#=-]?\s*[A-Z0-9-]{4,}\b/gi,
  /\b(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g,
  /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,
  /\bBearer\s+[^\s,;]+/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|secret|token|cookie|authorization)\s*[:=]\s*[^\s,;]+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-[A-Za-z0-9._-]{8,}\b/g,
  /\b\d{6,}\b/g,
];
const NAME_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isObject(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null;
}

function isError(value: unknown): value is Error {
  return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
}

function scrubString(value: string, key: string, maxLength: number): string {
  let result = value.length > maxLength ? `${value.slice(0, maxLength)}[TRUNCATED]` : value;
  for (const pattern of VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  NAME_PATTERN.lastIndex = 0;
  if (normalizeKey(key) === 'name' || NAME_PATTERN.test(result)) result = result.replace(NAME_PATTERN, REDACTED);
  if (normalizeKey(key) === 'name') return REDACTED;
  return result;
}

function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    const keys = [...url.searchParams.keys()];
    url.search = keys.length > 0 ? keys.map((key) => `${encodeURIComponent(scrubString(key, 'url', MAX_STRING))}=redacted`).join('&') : '';
    return url.toString().replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED);
  } catch {
    return scrubString(value, 'url', MAX_STRING);
  }
}

function scrubHeaders(value: unknown): RecordValue {
  const output: RecordValue = {};
  if (!(typeof Headers !== 'undefined' && value instanceof Headers) && !isObject(value)) return output;
  const entries: Array<[string, string]> = [];
  if (value instanceof Headers) {
    value.forEach((headerValue, key) => entries.push([key, headerValue]));
  } else {
    for (const [key, headerValue] of Object.entries(value)) entries.push([key, typeof headerValue === 'string' ? headerValue : REDACTED]);
  }
  for (const [key, headerValue] of entries.slice(0, MAX_ITEMS)) {
    output[key] = SAFE_HEADERS.has(normalizeKey(key)) ? scrubString(headerValue, key, MAX_STRING) : REDACTED;
  }
  return output;
}

function serializeError(value: Error): RecordValue {
  const name = typeof value.name === 'string' ? scrubString(value.name, 'errorName', MAX_STRING) : 'Error';
  const message = typeof value.message === 'string' ? scrubString(value.message, 'message', MAX_STRING) : REDACTED;
  return { name, message };
}

interface State {
  seen: WeakSet<object>;
  bytes: number;
}

function redactInternal(value: unknown, depth: number, key: string, state: State): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';
  state.bytes += 1;
  if (state.bytes > MAX_BYTES) return '[TRUNCATED_SIZE]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return scrubString(value, key, MAX_STRING);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`;
  if (isError(value)) return serializeError(value);
  if (value instanceof URL) return scrubUrl(value.toString());
  if (typeof Headers !== 'undefined' && value instanceof Headers) return scrubHeaders(value);
  if (Object.prototype.toString.call(value) === '[object Request]') {
    const request = value as { url?: unknown; method?: unknown };
    return { url: typeof request.url === 'string' ? scrubUrl(request.url) : REDACTED, method: typeof request.method === 'string' ? request.method : REDACTED };
  }
  if (Object.prototype.toString.call(value) === '[object Response]') {
    const response = value as { status?: unknown };
    return { status: typeof response.status === 'number' ? response.status : REDACTED };
  }
  const objectValue = value as object;
  if (state.seen.has(objectValue)) return '[CIRCULAR]';
  state.seen.add(objectValue);
  try {
    if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => redactInternal(item, depth + 1, key, state));
    if (Object.prototype.toString.call(value) === '[object Map]') {
      return [...(value as Map<unknown, unknown>).entries()].slice(0, MAX_ITEMS).map(([entryKey, entryValue]) => [redactInternal(entryKey, depth + 1, key, state), redactInternal(entryValue, depth + 1, key, state)]);
    }
    if (Object.prototype.toString.call(value) === '[object Set]') return [...(value as Set<unknown>)].slice(0, MAX_ITEMS).map((entry) => redactInternal(entry, depth + 1, key, state));
    const output: RecordValue = {};
    for (const childKey of Object.keys(value as RecordValue).slice(0, MAX_ITEMS)) {
      if (childKey === '__proto__' || childKey === 'constructor' || childKey === 'prototype') continue;
      const normalized = normalizeKey(childKey);
      const child = (value as RecordValue)[childKey];
      if (!OPERATIONAL_KEYS.has(normalized) && (RAW_BODY_KEYS.has(normalized) || SENSITIVE_NAMES.has(normalized) || (normalized !== 'name' && normalized.includes('name')) || SENSITIVE_PARTS.some((part) => normalized.includes(part)))) output[childKey] = REDACTED;
      else if (normalized === 'headers') output[childKey] = scrubHeaders(child);
      else if (!SAFE_KEYS.has(normalized) && !['providerresponse', 'metadata', 'request', 'errors'].includes(normalized)) output[childKey] = REDACTED;
      else if (['url', 'uri', 'href', 'endpoint'].includes(normalized) && typeof child === 'string') output[childKey] = scrubUrl(child);
      else output[childKey] = redactInternal(child, depth + 1, childKey, state);
    }
    return output;
  } finally {
    state.seen.delete(objectValue);
  }
}

export function redactLogValue<T = unknown>(value: T): T {
  return redactInternal(value, 0, '', { seen: new WeakSet<object>(), bytes: 0 }) as T;
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createEventId(event: string, seed: unknown = ''): string {
  const name = typeof event === 'string' ? event.slice(0, 120) : 'event';
  let seedText: string;
  try {
    seedText = typeof seed === 'string' ? seed : JSON.stringify(seed) ?? String(seed);
  } catch {
    seedText = String(seed);
  }
  return `evt_${fnv1a(`${name}|${seedText}`)}`;
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(redactLogValue(value)) ?? 'null';
  } catch {
    return JSON.stringify({ value: '[UNSERIALIZABLE]' });
  }
}

function emit(level: 'debug' | 'info' | 'warn' | 'error', event: string, error?: unknown, context?: unknown): void {
  if (level === 'debug' || level === 'info') {
    if ((Deno.env.get('DENO_ENV') ?? 'development') === 'production') return;
  }
  const eventId = createEventId(event, `${Date.now()}:${Math.random()}`);
  const redactedContext = redactLogValue(context ?? {});
  const entry: RecordValue = {
    ts: new Date().toISOString(),
    eventId,
    level,
    event: typeof event === 'string' ? event.slice(0, 120) : 'event',
    context: redactedContext,
  };
  if (error !== undefined) entry.error = isError(error) ? serializeError(error) : REDACTED;
  const line = safeStringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function logDebug(event: string, context?: unknown): void {
  emit('debug', event, undefined, context);
}

export function logInfo(event: string, context?: unknown): void {
  emit('info', event, undefined, context);
}

export function logWarn(event: string, context?: unknown): void {
  emit('warn', event, undefined, context);
}

export function logError(event: string, error?: unknown, context?: unknown): void {
  emit('error', event, error, context);
}
