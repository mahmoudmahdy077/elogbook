/**
 * Content-Security-Policy construction (T06/F07).
 *
 * Built per request in proxy.ts (server-side), so the *configured* Supabase
 * origin can join the policy. A build-time constant cannot do this: the same
 * image must serve cloud (`*.supabase.co`) and self-hosted origins without
 * rebuilding. Only http(s) origins parsed from NEXT_PUBLIC_SUPABASE_URL are
 * admitted; anything else contributes nothing (fail to base allowlist).
 */

const isProd = process.env.NODE_ENV === 'production';

/** Extra CSP origins for the configured Supabase URL, or [] for cloud/unset/invalid. */
export function supabaseCspOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
  if (url.hostname.endsWith('.supabase.co')) return [];
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return [`${url.protocol}//${url.host}`, `${wsProtocol}//${url.host}`];
}

export function buildCsp(nonce: string): string {
  const extra = supabaseCspOrigins();
  const httpOrigins = extra.filter((o) => o.startsWith('http'));
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://*.supabase.co${httpOrigins.length ? ` ${httpOrigins.join(' ')}` : ''}`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${extra.length ? ` ${extra.join(' ')}` : ''} https://*.sentry.io https://*.posthog.com https://api.stripe.com`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-violation",
  ].join('; ');
}
