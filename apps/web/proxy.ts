import { updateSession } from '@/lib/supabase/middleware';
import type { NextRequest } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { buildCsp as generateCsp } from '@/lib/csp';

const isProd = process.env.NODE_ENV === 'production';

export default async function proxy(request: NextRequest) {
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

  const nonce = crypto.randomUUID();

  request.headers.set('x-nonce', nonce);

  const response = await updateSession(request);

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
