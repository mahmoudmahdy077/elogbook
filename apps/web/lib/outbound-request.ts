import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import {
  isBlockedIpAddress,
  parseIpAddress,
  validateOutboundUrl,
  validateRedirectUrl,
  validateResolvedAddresses,
  type OutboundUrlPolicy,
} from '@elogbook/shared/security/outbound-url';

export const DEFAULT_OUTBOUND_TIMEOUT_MS = 5_000;
export const DEFAULT_OUTBOUND_RESPONSE_BYTES = 1_048_576;
export const DEFAULT_OUTBOUND_REQUEST_BYTES = 1_048_576;
export const DEFAULT_OUTBOUND_CONCURRENCY = 16;

export type OutboundStatusCategory =
  | 'success'
  | 'redirect'
  | 'client_error'
  | 'server_error'
  | 'network'
  | 'timeout'
  | 'too_large'
  | 'blocked'
  | 'invalid_response';

export type OutboundResult<T = never> = {
  ok: boolean;
  status: number;
  category: OutboundStatusCategory;
  data?: T;
};

export type OutboundRequestOptions = OutboundUrlPolicy & {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRequestBodyBytes?: number;
  maxConcurrent?: number;
  fetchImpl?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  requireAllowlist?: boolean;
  parseJson?: boolean;
  parseText?: boolean;
  signal?: AbortSignal;
};

const activeRequests: Array<() => void> = [];
let activeRequestCount = 0;

function clamp(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), maximum));
}

function hostEntries(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function configuredOutboundHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    ...hostEntries(env.OUTBOUND_ALLOWED_HOSTS),
    ...hostEntries(env.WEBHOOK_ALLOWED_HOSTS),
  ];
}

export function isExplicitlyAllowedHost(hostname: string, allowedHosts: readonly string[]): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return allowedHosts.some((entry) => {
    const wildcard = entry.trim().startsWith('*.');
    const candidate = entry.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
    return wildcard ? normalized.endsWith(`.${candidate}`) : candidate === normalized;
  });
}

function bodyByteLength(body: BodyInit | null | undefined): number | null {
  if (body === null || body === undefined) return 0;
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return null;
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  if (parseIpAddress(hostname)) return [hostname];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function acquireSlot(limit: number): Promise<() => void> {
  if (activeRequestCount >= limit) {
    await new Promise<void>((resolve) => activeRequests.push(resolve));
  }
  activeRequestCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRequestCount -= 1;
    activeRequests.shift()?.();
  };
}

function statusCategory(status: number): OutboundStatusCategory {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400 && status < 500) return 'client_error';
  return 'server_error';
}

type BoundedBody = {
  ok: true;
  text: string;
} | {
  ok: false;
  category: 'too_large' | 'invalid_response';
};

async function readBoundedBody(response: Response, maxBytes: number): Promise<BoundedBody> {
  if (!response.body) {
    try {
      const text = typeof response.text === 'function' ? await response.text() : '';
      if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, category: 'too_large' };
      return { ok: true, text };
    } catch {
      return { ok: false, category: 'invalid_response' };
    }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (!result.value) continue;
    total += result.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, category: 'too_large' };
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, category: 'invalid_response' };
  }
}

function withTimeout(
  timeoutMs: number,
  signal: AbortSignal | undefined,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

function parseJsonBody<T>(text: string): T | null {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function canPinBody(body: BodyInit | null | undefined): boolean {
  return body === null || body === undefined || typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
}

function requestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function nodeResponse(response: import('node:http').IncomingMessage): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value !== undefined) headers.set(key, value);
  }
  const status = response.statusCode ?? 502;
  const body = status === 204 || status === 205 || status === 304
    ? null
    : Readable.toWeb(response) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}

async function pinnedNodeFetch(
  url: URL,
  init: RequestInit,
  address: string,
): Promise<Response> {
  const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const normalizedAddress = address.replace(/^\[|\]$/g, '');
  const family = normalizedAddress.includes(':') ? 6 : 4;
  return new Promise<Response>((resolve, reject) => {
    const request = requester(url, {
      method: init.method ?? 'GET',
      headers: requestHeaders(init.headers),
      signal: init.signal ?? undefined,
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, normalizedAddress, family),
    }, (response) => resolve(nodeResponse(response)));
    request.on('error', reject);
    if (init.body === null || init.body === undefined) {
      request.end();
      return;
    }
    if (typeof init.body === 'string') request.write(init.body);
    else if (init.body instanceof Uint8Array) request.write(init.body);
    else if (init.body instanceof ArrayBuffer) request.write(new Uint8Array(init.body));
    else if (ArrayBuffer.isView(init.body)) {
      request.write(Buffer.from(init.body.buffer as ArrayBuffer, init.body.byteOffset, init.body.byteLength));
    }
    request.end();
  });
}

export async function outboundRequest<T = never>(
  rawUrl: string,
  options: OutboundRequestOptions = {},
): Promise<OutboundResult<T>> {
  let url: URL;
  try {
    url = validateOutboundUrl(rawUrl, options);
  } catch {
    return { ok: false, status: 0, category: 'blocked' };
  }

  const allowedHosts = options.allowedHosts ?? configuredOutboundHosts();
  if (options.requireAllowlist && !isExplicitlyAllowedHost(url.hostname, allowedHosts)) {
    return { ok: false, status: 0, category: 'blocked' };
  }

  const requestBytes = bodyByteLength(options.body);
  const maxRequestBytes = clamp(options.maxRequestBodyBytes, DEFAULT_OUTBOUND_REQUEST_BYTES, 5 * 1_048_576);
  if (requestBytes !== null && requestBytes > maxRequestBytes) {
    return { ok: false, status: 0, category: 'too_large' };
  }

  let addresses: readonly string[];
  try {
    const resolver = options.resolveHostname ?? defaultResolveHostname;
    addresses = await resolver(url.hostname);
    validateResolvedAddresses(url.hostname, addresses, options);
  } catch {
    return { ok: false, status: 0, category: 'blocked' };
  }

  const release = await acquireSlot(clamp(options.maxConcurrent, DEFAULT_OUTBOUND_CONCURRENCY, 64));
  const timeout = withTimeout(clamp(options.timeoutMs, DEFAULT_OUTBOUND_TIMEOUT_MS, 30_000), options.signal);
  const requestInit: RequestInit = {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
    redirect: 'manual',
    signal: timeout.signal,
  };
  const canUsePinnedFetch = !options.fetchImpl && process.env.NODE_ENV !== 'test' && canPinBody(options.body) &&
    typeof process !== 'undefined' && Boolean(process.versions?.node);
  try {
    const response = options.fetchImpl
      ? await options.fetchImpl(url.toString(), requestInit)
      : canUsePinnedFetch
        ? await pinnedNodeFetch(url, requestInit, addresses[0] as string)
        : await fetch(url.toString(), requestInit);
    const body = await readBoundedBody(response, clamp(options.maxResponseBytes, DEFAULT_OUTBOUND_RESPONSE_BYTES, 5 * 1_048_576));
    if (!body.ok) return { ok: false, status: response.status, category: body.category };
    const category = statusCategory(response.status);
    const result: OutboundResult<T> = {
      ok: response.ok,
      status: response.status,
      category,
    };
    if (options.parseText) {
      result.data = body.text as T;
    } else if (options.parseJson) {
      const parsed = parseJsonBody<T>(body.text);
      if (parsed === null) return { ok: false, status: response.status, category: 'invalid_response' };
      result.data = parsed;
    }
    return result;
  } catch (error) {
    const timedOut = timeout.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    return { ok: false, status: 0, category: timedOut ? 'timeout' : 'network' };
  } finally {
    timeout.cleanup();
    release();
  }
}

export async function outboundRequestJson<T>(
  url: string,
  options: OutboundRequestOptions = {},
): Promise<OutboundResult<T>> {
  return outboundRequest<T>(url, { ...options, parseJson: true });
}

export async function outboundRequestText(
  url: string,
  options: OutboundRequestOptions = {},
): Promise<OutboundResult<string>> {
  return outboundRequest<string>(url, { ...options, parseText: true });
}

export function validateOutboundRedirect(
  currentUrl: string,
  nextUrl: string,
  options: OutboundUrlPolicy = {},
): URL {
  const current = validateOutboundUrl(currentUrl, options);
  return validateRedirectUrl(nextUrl, current, options);
}

export function blockedAddressResult(): OutboundResult {
  return { ok: false, status: 0, category: 'blocked' };
}

export function isBlockedOutboundAddress(address: string): boolean {
  return isBlockedIpAddress(address);
}
