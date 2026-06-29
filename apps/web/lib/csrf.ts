import { NextResponse } from 'next/server';

/**
 * Validate the request's Origin (or Referer fallback) against a list of
 * trusted origins. Returns null if the origin is allowed, or a 403 response
 * if it should be rejected.
 *
 * This is a defense-in-depth CSRF mitigation for state-changing requests
 * (POST/PUT/DELETE/PATCH) on routes that don't already use a token-based
 * CSRF system. Browsers attach Origin on most cross-origin requests;
 * for backward compatibility we fall back to Referer.
 */
export function validateOrigin(
  request: Request,
  trustedOrigins: string[] = [],
): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const requestOrigin = origin ?? (referer ? new URL(referer).origin : null);

  if (!requestOrigin) {
    return NextResponse.json(
      { error: 'Origin required for state-changing requests' },
      { status: 403 },
    );
  }

  const allowed = trustedOrigins.some((o) => {
    if (o === requestOrigin) return true;
    if (o === '*') return true;
    return false;
  });

  if (!allowed) {
    return NextResponse.json(
      { error: 'Origin not allowed' },
      { status: 403 },
    );
  }

  return null;
}

/**
 * Build the default list of trusted origins from the request URL and
 * common deployment env vars. Pass the result to validateOrigin.
 */
export function defaultTrustedOrigins(request: Request): string[] {
  const origins = new Set<string>();
  try {
    origins.add(new URL(request.url).origin);
  } catch {
    /* ignore */
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    origins.add(process.env.NEXT_PUBLIC_SITE_URL);
  }
  return Array.from(origins);
}
