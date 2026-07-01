import { updateSession } from '@/lib/supabase/middleware';
import type { NextRequest } from 'next/server';

const isProd = process.env.NODE_ENV === 'production';

function generateCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // P4.7: drop 'unsafe-inline' (rely on nonce + strict-dynamic).
    // 'unsafe-eval' is dev-only — see also P4.7 note about next.config.js.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.posthog.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export default async function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID();

  const response = await updateSession(request);

  // Strict CSP: nonce + strict-dynamic, frame-ancestors 'none'.
  // HSTS is set in next.config.js for production.
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
