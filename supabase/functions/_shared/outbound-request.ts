import {
  isBlockedIpAddress,
  type OutboundUrlPolicy,
  validateOutboundUrl,
  validateRedirectUrl,
  validateResolvedAddresses,
} from "./outbound-url.ts";

/**
 * DNS validation without connection pinning is vulnerable to rebinding.
 * Deno 2's TCP transport is used to connect fetch to the exact validated IP
 * while retaining the original URL for TLS SNI and HTTP Host. Runtimes without
 * that API fail closed. Deployments that cannot expose this capability must
 * use an approved DNS-pinning egress proxy and an explicit adapter; ordinary
 * global fetch is not an approved fallback.
 */

export const DEFAULT_OUTBOUND_TIMEOUT_MS = 30_000;
export const DEFAULT_OUTBOUND_RESPONSE_BYTES = 1_048_576;
export const DEFAULT_OUTBOUND_REQUEST_BYTES = 1_048_576;
export const DEFAULT_OUTBOUND_CONCURRENCY = 8;

export type OutboundStatusCategory =
  | "success"
  | "redirect"
  | "client_error"
  | "server_error"
  | "network"
  | "timeout"
  | "too_large"
  | "blocked"
  | "invalid_response";

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
  resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  requireAllowlist?: boolean;
  parseJson?: boolean;
  parseText?: boolean;
  signal?: AbortSignal;
};

const activeRequests: Array<() => void> = [];
let activeRequestCount = 0;

function clamp(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), maximum));
}

function hostEntries(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function configuredOutboundHosts(): string[] {
  return [
    ...hostEntries(Deno.env.get("OUTBOUND_ALLOWED_HOSTS")),
    ...hostEntries(Deno.env.get("WEBHOOK_ALLOWED_HOSTS")),
  ];
}

export function isExplicitlyAllowedHost(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(
    /\.$/,
    "",
  );
  return allowedHosts.some((entry) => {
    const wildcard = entry.trim().startsWith("*.");
    const candidate = entry.trim().toLowerCase().replace(/^\*\./, "").replace(
      /\.$/,
      "",
    );
    return wildcard
      ? normalized.endsWith(`.${candidate}`)
      : candidate === normalized;
  });
}

function bodyByteLength(body: BodyInit | null | undefined): number | null {
  if (body === null || body === undefined) return 0;
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return null;
}

function isLiteralHostname(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, "");
  return value.includes(":") || /^[0-9.]+$/.test(value) ||
    /^0x[0-9a-f]+$/i.test(value);
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  if (isLiteralHostname(hostname)) return [hostname.replace(/^\[|\]$/g, "")];
  const results = await Promise.allSettled([
    Deno.resolveDns(hostname, "A"),
    Deno.resolveDns(hostname, "AAAA"),
  ]);
  const addresses = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  if (addresses.length === 0) throw new Error("DNS resolution failed");
  return addresses;
}

type PinnedHttpClientFactory = (options: {
  proxy: { transport: "tcp"; hostname: string; port: number };
}) => Deno.HttpClient;

function createPinnedHttpClient(
  url: URL,
  address: string,
): Deno.HttpClient | null {
  const runtime = (globalThis as {
    Deno?: { createHttpClient?: PinnedHttpClientFactory };
  }).Deno;
  if (typeof runtime?.createHttpClient !== "function") return null;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  try {
    return runtime.createHttpClient({
      proxy: { transport: "tcp", hostname: address, port },
    });
  } catch {
    return null;
  }
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
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "client_error";
  return "server_error";
}

type BoundedBody = { ok: true; text: string } | {
  ok: false;
  category: "too_large" | "invalid_response";
};

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<BoundedBody> {
  if (!response.body) {
    try {
      const text = typeof response.text === "function"
        ? await response.text()
        : "";
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        return { ok: false, category: "too_large" };
      }
      return { ok: true, text };
    } catch {
      return { ok: false, category: "invalid_response" };
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
      return { ok: false, category: "too_large" };
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
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { ok: false, category: "invalid_response" };
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
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function parseJsonBody<T>(text: string): T | null {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function outboundRequest<T = never>(
  rawUrl: string,
  options: OutboundRequestOptions = {},
): Promise<OutboundResult<T>> {
  let url: URL;
  try {
    url = validateOutboundUrl(rawUrl, options);
  } catch {
    return { ok: false, status: 0, category: "blocked" };
  }
  const allowedHosts = options.allowedHosts ?? configuredOutboundHosts();
  if (
    options.requireAllowlist &&
    !isExplicitlyAllowedHost(url.hostname, allowedHosts)
  ) {
    return { ok: false, status: 0, category: "blocked" };
  }
  const requestBytes = bodyByteLength(options.body);
  const maxRequestBytes = clamp(
    options.maxRequestBodyBytes,
    DEFAULT_OUTBOUND_REQUEST_BYTES,
    5 * 1_048_576,
  );
  if (requestBytes !== null && requestBytes > maxRequestBytes) {
    return { ok: false, status: 0, category: "too_large" };
  }

  let pinnedAddress: string;
  try {
    const resolver = options.resolveHostname ?? defaultResolveHostname;
    const addresses = validateResolvedAddresses(
      url.hostname,
      await resolver(url.hostname),
    );
    pinnedAddress = addresses[0] as string;
  } catch {
    return { ok: false, status: 0, category: "blocked" };
  }

  const pinnedClient = createPinnedHttpClient(url, pinnedAddress);
  if (!pinnedClient) {
    return { ok: false, status: 0, category: "blocked" };
  }

  const release = await acquireSlot(
    clamp(options.maxConcurrent, DEFAULT_OUTBOUND_CONCURRENCY, 32),
  );
  const timeout = withTimeout(
    clamp(options.timeoutMs, DEFAULT_OUTBOUND_TIMEOUT_MS, 60_000),
    options.signal,
  );
  try {
    const response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      signal: timeout.signal,
      client: pinnedClient,
    });
    const body = await readBoundedBody(
      response,
      clamp(
        options.maxResponseBytes,
        DEFAULT_OUTBOUND_RESPONSE_BYTES,
        5 * 1_048_576,
      ),
    );
    if (!body.ok) {
      return { ok: false, status: response.status, category: body.category };
    }
    const result: OutboundResult<T> = {
      ok: response.ok,
      status: response.status,
      category: statusCategory(response.status),
    };
    if (options.parseText) {
      result.data = body.text as T;
    } else if (options.parseJson) {
      const data = parseJsonBody<T>(body.text);
      if (data === null) {
        return {
          ok: false,
          status: response.status,
          category: "invalid_response",
        };
      }
      result.data = data;
    }
    return result;
  } catch (error) {
    const timedOut = timeout.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError");
    return { ok: false, status: 0, category: timedOut ? "timeout" : "network" };
  } finally {
    timeout.cleanup();
    release();
  }
}

export function outboundRequestJson<T>(
  url: string,
  options: OutboundRequestOptions = {},
): Promise<OutboundResult<T>> {
  return outboundRequest<T>(url, { ...options, parseJson: true });
}

export function outboundRequestText(
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
  return validateRedirectUrl(
    nextUrl,
    validateOutboundUrl(currentUrl, options),
    options,
  );
}

export function blockedAddressResult(): OutboundResult {
  return { ok: false, status: 0, category: "blocked" };
}

export function isBlockedOutboundAddress(address: string): boolean {
  return isBlockedIpAddress(address);
}
