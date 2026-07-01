import { updateSession } from '@/lib/supabase/middleware';
import type { NextRequest } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

const isProd = process.env.NODE_ENV === 'production';

function generateCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.posthog.com https://api.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-violation",
  ].join('; ');
}

export default async function proxy(request: NextRequest) {
  const { pathname } = new URL(request.url);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown';

  // Rate limiting for auth endpoints
  if (pathname.startsWith('/auth/callback') && request.method === 'POST') {
    const { allowed, retryAfter } = checkRateLimit(`auth-cb:${ip}`);
    if (!allowed) return rateLimitResponse(retryAfter);
  }

  // Rate limiting for login
  if (pathname === '/login' && request.method === 'POST') {
    const { allowed, retryAfter } = checkRateLimit(`login:${ip}`);
    if (!allowed) return rateLimitResponse(retryAfter);
  }

  // Rate limiting for unauthenticated API routes
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth')) {
    const { allowed, retryAfter } = checkRateLimit(`api:${ip}`);
    if (!allowed) return rateLimitResponse(retryAfter);
  }

  const nonce = crypto.randomUUID();

  const response = await updateSession(request);

  response.headers.set('Content-Security-Policy', generateCsp(nonce));
  response.headers.set('x-nonce', nonce);
  if (isProd) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
