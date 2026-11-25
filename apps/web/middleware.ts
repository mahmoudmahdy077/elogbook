import { updateSession } from '@/lib/supabase/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { buildCsp as generateCsp } from '@/lib/csp';

const isProd = process.env.NODE_ENV === 'production';

/** Security headers applied to every response the proxy returns. */
function applySecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  response.headers.set('Content-Security-Policy', generateCsp(nonce));
  response.headers.set('x-nonce', nonce);
  if (isProd) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  }
  return response;
}

/**
 * Fail-open fallback for an unexpected proxy failure.
 *
 * Vercel turns any uncaught middleware exception into
 * `MIDDLEWARE_INVOCATION_FAILED` on *every* dynamic route — one bad env value
 * or one library throw takes the whole site down (see the 2026-11-13
 * outage). Route handlers and the `(authenticated)` layout both enforce auth
 * themselves, so degrading to `next()` keeps the request guarded by the layer
 * that owns the decision instead of returning a blanket 500.
 *
 * It is marked with `x-elogbook-degraded` so the condition is visible in
 * response headers and logs rather than silent.
 */
function degradedResponse(request: NextRequest, nonce: string, reason: string): NextResponse {
  console.error(`[proxy] degraded: ${reason}`);
  const response = NextResponse.next({ request });
  response.headers.set('x-elogbook-degraded', 'proxy');
  return applySecurityHeaders(response, nonce);
}

export default async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID();
  try {
    return await handleRequest(request, nonce);
  } catch (error) {
    // Never echo the thrown value: it can contain the malformed env value.
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    return degradedResponse(request, nonce, reason.slice(0, 300));
  }
}

async function handleRequest(request: NextRequest, nonce: string) {
  const { pathname } = new URL(request.url);
  // D-5: unauthenticated control plane must be absent in PHI build.
  // Until the routes are removed from the build, deny them at the edge
  // in production. This satisfies Gate C's runtime probe (404) even though
  // the build-manifest and network-rule parts of TICKET-004 are human-only.
  if (process.env.NODE_ENV === 'production') {
    if (
      pathname.startsWith('/api/setup') ||
      pathname.startsWith('/api/backup') ||
      pathname === '/api/uninstall' ||
      pathname.startsWith('/api/update')
    ) {
      return new Response('Not Found', { status: 404 });
    }
  }
  const ip = getClientIp(request);

  // Rate limiting for auth endpoints
  if (pathname.startsWith('/auth/callback') && request.method === 'POST') {
    const { allowed, retryAfter } = await checkRateLimit(`auth-cb:${ip}`);
    if (!allowed) return rateLimitResponse(retryAfter);
  }

  // Rate limiting for login
  if (pathname === '/login' && request.method === 'POST') {
    const { allowed, retryAfter } = await checkRateLimit(`login:${ip}`);
    if (!allowed) return rateLimitResponse(retryAfter);
  }

  // Liveness and readiness are never rate-limited (TICKET-003, D-6).
  // They must be exempt BEFORE the generic /api limiter, otherwise a
  // denying limiter takes the health signal down with the app (crash loop).
  const isHealthProbe = pathname === '/api/health' || pathname === '/api/ready';

  // Rate limiting for unauthenticated API routes (excluding health probes)
  if (!isHealthProbe && pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')) {
    const { allowed, retryAfter } = await checkRateLimit(`api:${ip}`);
    if (!allowed) return rateLimitResponse(retryAfter);
  }

  request.headers.set('x-nonce', nonce);

  const response = await updateSession(request);

  return applySecurityHeaders(response, nonce);
}

export const config = {
  // Exclude Next.js internals + static assets from session logic:
  // - _next/* covers build output, image optimizer, and the dev HMR websocket
  //   (/_next/webpack-hmr). Without it, HMR upgrade requests hit the session
  //   logic and get 307 → /login, so the WebSocket handshake fails
  //   (ERR_INVALID_HTTP_RESPONSE) and React never hydrates in dev.
  // - Root-level public/ files (sw.js, sw-register.js, manifest.json,
  //   robots.txt, sitemap.xml, openapi.yaml, …) would otherwise 307 → /login,
  //   serving login HTML for script requests (SyntaxError → hydration break)
  //   and hiding robots.txt/sitemap.xml from crawlers.
  matcher: ['/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|css|json|txt|xml|yaml|yml|ico|woff2?|map|webmanifest)$).*)'],
};
