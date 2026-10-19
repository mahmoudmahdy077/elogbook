import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { defaultTrustedOrigins, validateOrigin } from '@/lib/csrf';

export const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024;

export type RequestGuardOptions<T = unknown> = {
  schema?: ZodType<T>;
  trustedOrigins?: string[];
  maxBodyBytes?: number;
  allowedContentTypes?: readonly string[];
  allowedKeys?: readonly string[];
  requireBody?: boolean;
  requireOrigin?: boolean;
};

export type RequestGuardResult<T> =
  | { ok: true; data: T; text: string }
  | { ok: false; response: NextResponse };

type GuardedHandler<TArgs extends unknown[]> = (
  request: Request,
  data: unknown,
  ...args: TArgs
) => Promise<Response> | Response;

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(mediaType);
}

function isStateChanging(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function getDeclaredBodyLength(request: Request): number | null {
  const value = request.headers.get('content-length');
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function inferAllowedKeys(schema: ZodType | undefined, explicit: readonly string[] | undefined): Set<string> | null {
  if (explicit) return new Set(explicit);
  if (!schema) return null;
  const definition = (schema as unknown as { def?: { type?: string; shape?: unknown } }).def;
  if (definition?.type !== 'object' || typeof definition.shape !== 'function') return null;
  const shape = definition.shape as () => Record<string, unknown>;
  return new Set(Object.keys(shape()));
}

async function readBodyText(request: Request, maxBodyBytes: number): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  const declaredLength = getDeclaredBodyLength(request);
  if (Number.isNaN(declaredLength)) {
    return { ok: false, response: jsonError('Invalid request body', 400) };
  }
  if (declaredLength !== null && declaredLength > maxBodyBytes) {
    return { ok: false, response: jsonError('Request body too large', 413) };
  }
  if (!request.body) return { ok: true, text: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (result.value) {
      total += result.value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        return { ok: false, response: jsonError('Request body too large', 413) };
      }
      chunks.push(result.value);
    }
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
    return { ok: false, response: jsonError('Invalid request body', 400) };
  }
}

export async function readRequestBody(
  request: Request,
  maxBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  return readBodyText(request, maxBodyBytes);
}

function rejectUnknownKeys(value: unknown, allowedKeys: Set<string> | null): boolean {
  if (allowedKeys === null || value === null || typeof value !== 'object' || Array.isArray(value)) return true;
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function originFailure(): NextResponse {
  return jsonError('Origin not allowed', 403);
}

export async function guardRequest<T = unknown>(
  request: Request,
  schema?: ZodType<T>,
  options: RequestGuardOptions<T> = {},
): Promise<RequestGuardResult<T>> {
  const method = request.method.toUpperCase();
  if (isStateChanging(method) && options.requireOrigin !== false) {
    let originResponse: NextResponse | null = null;
    try {
      originResponse = validateOrigin(request, options.trustedOrigins ?? defaultTrustedOrigins(request));
    } catch {
      originResponse = originFailure();
    }
    if (originResponse) return { ok: false, response: originResponse };
  }

  const requiresBody = options.requireBody ?? schema !== undefined;
  if (!requiresBody) {
    return { ok: true, data: undefined as T, text: '' };
  }

  if (request.body !== null) {
    const contentType = request.headers.get('content-type');
    const normalizedActual = contentType?.split(';', 1)[0]?.trim().toLowerCase();
    const validContentType = options.allowedContentTypes
      ? options.allowedContentTypes.some((allowed) => normalizedActual === allowed.split(';', 1)[0]?.trim().toLowerCase())
      : isJsonContentType(contentType ?? '');
    if (!validContentType) return { ok: false, response: jsonError('Unsupported content type', 415) };
  } else if (request.method.toUpperCase() !== 'DELETE') {
    return { ok: false, response: jsonError('Request body is required', 400) };
  }

  const body = await readBodyText(request, options.maxBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES);
  if (!body.ok) return body;
  if (body.text.trim() === '') return { ok: false, response: jsonError('Request body is required', 400) };

  let value: unknown;
  try {
    value = JSON.parse(body.text) as unknown;
  } catch {
    return { ok: false, response: jsonError('Invalid request body', 400) };
  }
  if (!rejectUnknownKeys(value, inferAllowedKeys(schema, options.allowedKeys))) {
    return { ok: false, response: jsonError('Invalid request body', 400) };
  }
  if (schema) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return { ok: false, response: jsonError('Invalid request body', 400) };
    return { ok: true, data: parsed.data, text: body.text };
  }
  return { ok: true, data: value as T, text: body.text };
}

export async function readJsonBody<T = unknown>(
  request: Request,
  schema?: ZodType<T>,
  options: RequestGuardOptions<T> = {},
): Promise<RequestGuardResult<T>> {
  return guardRequest(request, schema, { ...options, requireBody: true });
}

export function withRequestGuard<TArgs extends unknown[] = []>(
  handler: GuardedHandler<TArgs>,
  options: RequestGuardOptions,
): (request: Request, ...args: TArgs) => Promise<Response> {
  return async (request, ...args) => {
    try {
      const guarded = await guardRequest(request, options.schema, options);
      if (!guarded.ok) return guarded.response;
      return await handler(request, guarded.data, ...args);
    } catch {
      return jsonError('Internal server error', 500);
    }
  };
}

export const guardRoute = withRequestGuard;
