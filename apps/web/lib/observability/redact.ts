export const REDACTED = '[REDACTED]';
export const MAX_REDACTION_DEPTH = 8;
export const MAX_REDACTION_BYTES = 16_384;
export const MAX_REDACTION_ITEMS = 50;
export const MAX_REDACTION_STRING = 512;

export type RedactionMode = 'allowlist' | 'compat';

export interface RedactionOptions {
  mode?: RedactionMode;
  maxDepth?: number;
  maxBytes?: number;
  maxItems?: number;
  maxStringLength?: number;
}

type JsonRecord = Record<string, unknown>;

const SAFE_KEYS = new Set([
  'action', 'category', 'code', 'component', 'correlationid', 'count', 'costcents', 'durationms', 'entries', 'environment', 'eventid', 'fingerprint', 'id', 'index', 'inputtokens', 'latencyms', 'level', 'matrix', 'message', 'method', 'model', 'msg', 'nested', 'operation', 'operationid', 'phase', 'platform', 'provider', 'reason', 'release', 'requestid', 'responseid', 'route', 'safe', 'severity', 'source', 'stack', 'status', 'statuscode', 'tenantid', 'timestamp', 'total', 'totaltokens', 'transaction', 'ts', 'type', 'url', 'uri', 'href', 'endpoint', 'usage', 'version',
]);

const SAFE_SENTRY_KEYS = new Set([
  'breadcrumbs', 'contexts', 'dist', 'environment', 'eventid', 'exception', 'fingerprint', 'level', 'logger', 'message', 'platform', 'release', 'request', 'sdk', 'servername', 'spans', 'starttimestamp', 'tags', 'timestamp', 'transaction', 'type', 'user',
]);

const OPERATIONAL_KEYS = new Set([
  'id', 'responseid', 'requestid', 'eventid', 'correlationid', 'count', 'index', 'status', 'statuscode', 'total', 'totaltokens', 'inputtokens', 'outputtokens', 'costcents', 'durationms', 'latencyms', 'model', 'provider', 'category', 'type', 'level', 'method', 'route', 'action', 'component', 'operation', 'operationid', 'phase', 'severity', 'source', 'version',
]);

const SAFE_HEADER_KEYS = new Set([
  'accept', 'contentlength', 'contenttype', 'useragent',
]);


const RAW_BODY_KEYS = new Set([
  'body', 'data', 'field_values', 'fieldvalues', 'input', 'messages', 'payload', 'prompt', 'requestbody', 'request_body', 'responsebody', 'response_body', 'responsetext', 'response_text', 'rawbody', 'raw_body', 'stream', 'text',
]);

const SENSITIVE_KEY_PARTS = [
  'authorization', 'cookie', 'setcookie', 'credential', 'password', 'passphrase', 'token', 'apikey', 'secret', 'privatekey', 'webhooksecret', 'mrn', 'dob', 'dateofbirth', 'birthdate', 'ssn', 'patienthash', 'fieldvalues', 'phi', 'email', 'mail', 'telephone', 'phone', 'address', 'encrypted',
];

const SENSITIVE_KEY_NAMES = new Set([
  'mrn', 'ssn', 'dob', 'name', 'fullname', 'firstname', 'lastname', 'patient', 'patientid', 'residentname', 'reviewername', 'displayname', 'username', 'user', 'cookies', 'cookie', 'authorization', 'accesstoken', 'refreshtoken', 'idtoken', 'clientsecret', 'apikey', 'secret', 'password', 'fieldvalues', 'patientmrn', 'patientdob', 'patienthash', 'email', 'emailaddress',
]);

const VALUE_PATTERNS: RegExp[] = [
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
const SINGLE_NAME_PATTERN = /^[A-Z][a-z]{1,30}$/;

function isObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clamp(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(value), maximum));
}

function tagOf(value: object): string {
  return Object.prototype.toString.call(value);
}

function isError(value: unknown): value is Error {
  return value instanceof Error || tagOf(value as object) === '[object Error]';
}

function isUrl(value: unknown): value is URL {
  return value instanceof URL || tagOf(value as object) === '[object URL]';
}

function isHeaders(value: unknown): value is Headers {
  return typeof Headers !== 'undefined' && value instanceof Headers;
}

function isRequest(value: unknown): boolean {
  return tagOf(value as object) === '[object Request]';
}

function isResponse(value: unknown): boolean {
  return tagOf(value as object) === '[object Response]';
}

function isNameSensitivePath(path: readonly string[]): boolean {
  return path.slice(0, -1).some((part) => {
    const normalized = normalizeKey(part);
    return ['providerresponse', 'response', 'choices', 'message', 'metadata', 'patient', 'user', 'profile', 'contact', 'recipient', 'sender'].includes(normalized);
  });
}

function isSensitiveKey(key: string, mode: RedactionMode, path: readonly string[]): boolean {
  const normalized = normalizeKey(key);
  if (OPERATIONAL_KEYS.has(normalized)) return false;
  if (RAW_BODY_KEYS.has(normalized) && !(mode === 'compat' && normalized === 'data')) return true;
  if (SENSITIVE_KEY_NAMES.has(normalized) && (mode === 'allowlist' || normalized !== 'name')) return true;
  if (normalized !== 'name' && normalized.includes('name')) return true;
  if (SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))) return true;
  if (isNameSensitivePath(path) && ['message', 'content', 'response', 'text'].includes(normalized)) return true;
  if (mode === 'compat' && normalized === 'name' && isNameSensitivePath(path)) return true;
  return false;
}

function isSafeKey(key: string, mode: RedactionMode, path: readonly string[]): boolean {
  const normalized = normalizeKey(key);
  if (mode === 'compat') return !isSensitiveKey(key, mode, path) && !RAW_BODY_KEYS.has(normalized);
  if (SAFE_KEYS.has(normalized)) return true;
  return ['headers', 'cookies', 'providerresponse', 'metadata', 'request', 'response', 'errors', 'user', 'custom', 'trace', 'react', 'runtime', 'app', 'os', 'device', 'gpu', 'culture', 'cloudresource', 'featureflags'].includes(normalized) && !isSensitiveKey(key, mode, path);
}

function isLikelyPersonName(value: string): boolean {
  return NAME_PATTERN.test(value);
}

function replaceValuePatterns(value: string): string {
  let result = value;
  for (const pattern of VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

function scrubString(value: string, key: string, mode: RedactionMode, path: readonly string[], maxStringLength: number): string {
  const bounded = value.length > maxStringLength ? `${value.slice(0, maxStringLength)}[TRUNCATED]` : value;
  let result = replaceValuePatterns(bounded);
  if ((mode === 'allowlist' || normalizeKey(key) === 'name' || isNameSensitivePath(path)) && isLikelyPersonName(result)) {
    NAME_PATTERN.lastIndex = 0;
    result = result.replace(NAME_PATTERN, REDACTED);
  }
  const normalizedKey = normalizeKey(key);
  if (mode === 'allowlist' && normalizedKey === 'name') return REDACTED;
  if (mode === 'allowlist' && ['message', 'msg'].includes(normalizedKey) && SINGLE_NAME_PATTERN.test(result.trim())) return REDACTED;
  return result;
}

function scrubUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    const query = [...url.searchParams.keys()];
    url.search = query.length > 0 ? query.map((key) => `${encodeURIComponent(replaceValuePatterns(key))}=redacted`).join('&') : '';
    const result = url.toString();
    return replaceValuePatterns(result);
  } catch {
    return replaceValuePatterns(value).replace(/([?&])([^=&]+)=([^&]*)/g, '$1$2=redacted');
  }
}

function readProperty(value: JsonRecord, key: string): unknown {
  try {
    return value[key];
  } catch {
    return REDACTED;
  }
}

function scrubHeaders(value: unknown, mode: RedactionMode, state: RedactionState, path: readonly string[]): JsonRecord {
  const output: JsonRecord = {};
  const entries: Array<[string, string]> = [];
  if (isHeaders(value)) {
    value.forEach((headerValue, key) => entries.push([key, headerValue]));
  } else if (isObject(value)) {
    for (const key of Object.keys(value)) {
      const headerValue = readProperty(value, key);
      if (typeof headerValue === 'string' || typeof headerValue === 'number') entries.push([key, String(headerValue)]);
      else entries.push([key, REDACTED]);
    }
  }
  for (const [key, headerValue] of entries.slice(0, state.maxItems)) {
    const normalized = normalizeKey(key);
    if (SAFE_HEADER_KEYS.has(normalized) && !isSensitiveKey(key, mode, path)) {
      output[key] = scrubString(headerValue, key, mode, path, state.maxStringLength);
    } else {
      output[key] = REDACTED;
    }
  }
  return output;
}

function serializeError(value: Error, mode: RedactionMode, state: RedactionState, path: readonly string[]): JsonRecord {
  const name = typeof value.name === 'string' ? scrubString(value.name, 'errorName', mode, path, state.maxStringLength) : 'Error';
  const message = typeof value.message === 'string' ? scrubString(value.message, 'message', mode, path, state.maxStringLength) : REDACTED;
  const stack = typeof value.stack === 'string' ? scrubString(value.stack, 'stack', mode, path, state.maxStringLength) : undefined;
  const result: JsonRecord = { name, message };
  if (stack) result.stack = mode === 'allowlist' ? REDACTED : stack;
  return result;
}

function serializeUrl(value: URL): string {
  return scrubUrl(value.toString());
}

function serializeRequest(value: object): JsonRecord {
  const request = value as { url?: unknown; method?: unknown };
  const result: JsonRecord = {};
  if (typeof request.url === 'string') result.url = scrubUrl(request.url);
  if (typeof request.method === 'string') result.method = request.method.toUpperCase();
  return result;
}

function serializeResponse(value: object): JsonRecord {
  const response = value as { status?: unknown; statusText?: unknown; url?: unknown };
  const result: JsonRecord = {};
  if (typeof response.status === 'number') result.status = response.status;
  if (typeof response.statusText === 'string') result.statusText = response.statusText;
  if (typeof response.url === 'string') result.url = scrubUrl(response.url);
  return result;
}

function serializeBinary(): string {
  return '[BINARY]';
}

interface RedactionState {
  seen: WeakSet<object>;
  bytes: number;
  maxDepth: number;
  maxBytes: number;
  maxItems: number;
  maxStringLength: number;
}

function consume(state: RedactionState, amount: number): boolean {
  if (state.bytes >= state.maxBytes) return false;
  state.bytes += Math.max(0, amount);
  return state.bytes <= state.maxBytes;
}

function redactInternal(value: unknown, mode: RedactionMode, depth: number, path: readonly string[], state: RedactionState): unknown {
  if (depth > state.maxDepth) return '[TRUNCATED_DEPTH]';
  if (!consume(state, 1)) return '[TRUNCATED_SIZE]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value, path[path.length - 1] ?? '', mode, path, state.maxStringLength);
  if (typeof value === 'number') return Number.isFinite(value) ? value : REDACTED;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value.toString()}]`;
  if (isError(value)) return serializeError(value, mode, state, path);
  if (isUrl(value)) return serializeUrl(value);
  if (isHeaders(value)) return scrubHeaders(value, mode, state, path);
  if (isRequest(value)) return serializeRequest(value as object);
  if (isResponse(value)) return serializeResponse(value as object);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return serializeBinary();

  const objectValue = value as object;
  if (state.seen.has(objectValue)) return '[CIRCULAR]';
  state.seen.add(objectValue);
  try {
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (const item of value.slice(0, state.maxItems)) {
        output.push(redactInternal(item, mode, depth + 1, path, state));
      }
      if (value.length > state.maxItems) output.push('[TRUNCATED_ITEMS]');
      return output;
    }
    if (tagOf(objectValue) === '[object Map]') {
      const entries: unknown[] = [];
      for (const [key, entry] of value as Map<unknown, unknown>) {
        if (entries.length >= state.maxItems) break;
        entries.push([redactInternal(key, mode, depth + 1, path, state), redactInternal(entry, mode, depth + 1, path, state)]);
      }
      return entries;
    }
    if (tagOf(objectValue) === '[object Set]') {
      const entries: unknown[] = [];
      for (const entry of value as Set<unknown>) {
        if (entries.length >= state.maxItems) break;
        entries.push(redactInternal(entry, mode, depth + 1, path, state));
      }
      return entries;
    }

    const output: JsonRecord = {};
    const keys = Object.keys(value as JsonRecord);
    for (const key of keys.slice(0, state.maxItems)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const normalized = normalizeKey(key);
      const currentPath = [...path, key];
      let redacted: unknown;
      if (normalized === 'error' || normalized === 'cause') {
        const child = readProperty(value as JsonRecord, key);
        redacted = isError(child) ? serializeError(child, mode, state, currentPath) : REDACTED;
      } else if (normalized === 'headers') {
        redacted = scrubHeaders(readProperty(value as JsonRecord, key), mode, state, currentPath);
      } else if (normalized === 'cookies') {
        redacted = REDACTED;
      } else if (RAW_BODY_KEYS.has(normalized) && !(mode === 'compat' && normalized === 'data')) {
        redacted = REDACTED;
      } else if (isSensitiveKey(key, mode, currentPath)) {
        redacted = REDACTED;
      } else if (!isSafeKey(key, mode, currentPath)) {
        redacted = mode === 'allowlist' ? REDACTED : redactInternal(readProperty(value as JsonRecord, key), mode, depth + 1, currentPath, state);
      } else {
        const child = readProperty(value as JsonRecord, key);
        if (normalized === 'url' || normalized === 'uri' || normalized === 'href' || normalized === 'endpoint') {
          redacted = typeof child === 'string' ? scrubUrl(child) : child;
        } else {
          redacted = redactInternal(child, mode, depth + 1, currentPath, state);
        }
      }
      if (consume(state, key.length + 8)) output[key] = redacted;
      if (state.bytes >= state.maxBytes) {
        output.__truncated__ = true;
        break;
      }
    }
    if (keys.length > state.maxItems) output.__truncated__ = true;
    return output;
  } finally {
    state.seen.delete(objectValue);
  }
}

function stateFrom(options: RedactionOptions): RedactionState {
  return {
    seen: new WeakSet<object>(),
    bytes: 0,
    maxDepth: clamp(options.maxDepth, MAX_REDACTION_DEPTH, 1, 32),
    maxBytes: clamp(options.maxBytes, MAX_REDACTION_BYTES, 256, 1_048_576),
    maxItems: clamp(options.maxItems, MAX_REDACTION_ITEMS, 1, 500),
    maxStringLength: clamp(options.maxStringLength, MAX_REDACTION_STRING, 32, 4_096),
  };
}

export function redact<T = unknown>(value: T, options: RedactionOptions = {}): T {
  return redactInternal(value, options.mode ?? 'allowlist', 0, [], stateFrom(options)) as T;
}

export function redactPHI<T = unknown>(value: T, options: RedactionOptions = {}): T {
  return redactInternal(value, options.mode ?? 'compat', 0, [], stateFrom(options)) as T;
}

export function sanitizeLogContext(value: unknown, options: RedactionOptions = {}): JsonRecord {
  const result = redact(value, options);
  return isObject(result) && !Array.isArray(result) ? result : { value: result };
}

export function safeStringify(value: unknown, space?: number): string {
  try {
    const serialized = JSON.stringify(redact(value), null, space);
    return serialized ?? 'null';
  } catch {
    return JSON.stringify({ value: '[UNSERIALIZABLE]' });
  }
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createEventId(eventName: string, seed?: unknown): string {
  const normalizedName = typeof eventName === 'string' && eventName.length > 0 ? eventName.slice(0, 120) : 'event';
  return `evt_${fnv1a(`${normalizedName}|${seed === undefined ? '' : safeStringify(seed)}`)}`;
}

function redactSentryValue(value: unknown, key: string, state: RedactionState, depth: number): unknown {
  const normalized = normalizeKey(key);
  if (normalized === 'request' && isObject(value)) return redactInternal(value, 'allowlist', depth + 1, [key], state);
  if (normalized === 'tags' && isObject(value)) {
    const tags: JsonRecord = {};
    for (const tagKey of Object.keys(value).slice(0, state.maxItems)) {
      const normalizedTag = normalizeKey(tagKey);
      const tagValue = readProperty(value, tagKey);
      if (['category', 'level', 'provider', 'status', 'type', 'environment', 'release', 'transaction', 'component', 'action'].includes(normalizedTag)) {
        if (typeof tagValue === 'string') tags[tagKey] = scrubString(tagValue, tagKey, 'allowlist', [key, tagKey], state.maxStringLength);
        else if (typeof tagValue === 'number' && Number.isFinite(tagValue)) tags[tagKey] = tagValue;
        else if (typeof tagValue === 'boolean') tags[tagKey] = tagValue;
        else tags[tagKey] = REDACTED;
      } else {
        tags[tagKey] = REDACTED;
      }
    }
    return tags;
  }
  if (normalized === 'breadcrumbs' && Array.isArray(value)) {
    return value.slice(0, state.maxItems).map((breadcrumb) => {
      if (!isObject(breadcrumb)) return REDACTED;
      const result: JsonRecord = {};
      for (const breadcrumbKey of Object.keys(breadcrumb).slice(0, state.maxItems)) {
        const breadcrumbValue = readProperty(breadcrumb, breadcrumbKey);
        const breadcrumbNormalized = normalizeKey(breadcrumbKey);
        if (['category', 'type', 'level', 'eventid', 'timestamp'].includes(breadcrumbNormalized)) {
          if (typeof breadcrumbValue === 'string') result[breadcrumbKey] = scrubString(breadcrumbValue, breadcrumbKey, 'allowlist', [key, breadcrumbKey], state.maxStringLength);
          else if (typeof breadcrumbValue === 'number' && Number.isFinite(breadcrumbValue)) result[breadcrumbKey] = breadcrumbValue;
          else if (typeof breadcrumbValue === 'boolean') result[breadcrumbKey] = breadcrumbValue;
          else result[breadcrumbKey] = REDACTED;
        } else if (breadcrumbNormalized === 'message') result[breadcrumbKey] = typeof breadcrumbValue === 'string' ? scrubString(breadcrumbValue, breadcrumbKey, 'allowlist', [key, breadcrumbKey], state.maxStringLength) : REDACTED;
        else if (breadcrumbNormalized === 'data' || breadcrumbNormalized === 'headers' || breadcrumbNormalized === 'cookies' || breadcrumbNormalized === 'body') result[breadcrumbKey] = REDACTED;
        else result[breadcrumbKey] = REDACTED;
      }
      return result;
    });
  }
  return redactInternal(value, 'allowlist', depth, [key], state);
}

function omitRedactedValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitRedactedValues).filter((entry) => entry !== REDACTED);
  if (!isObject(value)) return value;
  const result: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === REDACTED) continue;
    result[key] = omitRedactedValues(entry);
  }
  return result;
}

export function redactSentryEvent<T = unknown>(event: T): T {
  if (!isObject(event)) return redact(event);
  const state = stateFrom({ mode: 'allowlist' });
  const result: JsonRecord = {};
  for (const key of Object.keys(event).slice(0, state.maxItems)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const normalized = normalizeKey(key);
    if (!SAFE_SENTRY_KEYS.has(normalized) && !SAFE_KEYS.has(normalized)) {
      result[key] = REDACTED;
      continue;
    }
    const value = readProperty(event, key);
    result[key] = redactSentryValue(value, key, state, 0);
  }
  return omitRedactedValues(result) as T;
}
