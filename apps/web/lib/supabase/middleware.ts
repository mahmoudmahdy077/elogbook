import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { normalizeSupabaseKey, normalizeSupabaseUrl } from '@elogbook/env/supabase-url';

/**
 * P1.5: Defense-in-depth CSRF check for state-changing requests
 * (POST/PUT/DELETE/PATCH) in the middleware layer.
 *
 * Returns a 403 response if the Origin (or Referer fallback) does not
 * match the expected origin. This catches cross-origin requests that
 * individual route handlers might miss.
 */
function csrfGuard(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return null;
  }

  // Signed webhook deliveries (server→server, including self-delivery) carry
  // an HMAC signature instead of a browser Origin — never CSRF-relevant.
  if (request.headers.get('x-e-logbook-signature')) {
    return null;
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  // A malformed Referer must be rejected, not thrown: `new URL()` raises on
  // garbage and would turn one bad header into a 500 on the request.
  let refererOrigin: string | null = null;
  if (referer) {
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
  }
  const requestOrigin = origin ?? refererOrigin;

  if (!requestOrigin) {
    return NextResponse.json(
      { error: 'Origin header required for state-changing requests' },
      { status: 403 },
    );
  }

  // Build the set of expected origins
  const expectedOrigins = new Set<string>();
  try {
    expectedOrigins.add(new URL(request.url).origin);
  } catch {
    /* ignore */
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    expectedOrigins.add(process.env.NEXT_PUBLIC_SITE_URL);
  }

  if (!expectedOrigins.has(requestOrigin)) {
    return NextResponse.json(
      { error: 'Cross-origin state-changing request rejected' },
      { status: 403 },
    );
  }

  return null;
}

type SupabaseEnv =
  | { ok: true; url: string; key: string }
  | { ok: false; kind: 'missing' | 'invalid'; reason: string };

/**
 * One log line per edge isolate is enough to diagnose a bad deployment
 * value; logging it per request would flood the runtime logs.
 */
let warnedUnusableEnv = false;

function getEnvVars(): SupabaseEnv {
  const urlResult = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!urlResult.ok) {
    return { ok: false, kind: urlResult.kind, reason: urlResult.reason };
  }

  const key = normalizeSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!key) {
    return { ok: false, kind: 'missing', reason: 'NEXT_PUBLIC_SUPABASE_ANON_KEY is not set' };
  }

  return { ok: true, url: urlResult.url, key };
}

async function getUserTenantSlug(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<{ slug: string; role: string } | null> {
  const { data } = await supabase
    .from('profiles')
    .select('role, tenant_id, tenants!inner(slug)')
    .eq('user_id', userId)
    .single();

  if (!data) return null;

  const tenants = data.tenants as unknown as { slug: string } | null;
  return { slug: tenants?.slug ?? '', role: data.role };
}

export async function updateSession(request: NextRequest) {
  const env = getEnvVars();

  // If Supabase env vars aren't configured, just pass the request
  // through without session management. The page-level auth checks
  // will redirect to /login as needed.
  //
  // If they are configured but unusable (e.g. a quoted paste, or a URL
  // without https://), createServerClient() throws inside middleware — the
  // request never reaches a route and every dynamic route answers 500 with
  // MIDDLEWARE_INVOCATION_FAILED. Degrade instead: skip session handling,
  // name the cause in one log line and in a response header, and let the
  // page-level checks decide. The alternative is an opaque full outage.
  if (!env.ok) {
    if (env.kind === 'invalid') {
      if (!warnedUnusableEnv) {
        warnedUnusableEnv = true;
        console.error(
          `[proxy] Supabase env unusable, session handling disabled: ${env.reason}`,
        );
      }
      const degraded = NextResponse.next({ request });
      degraded.headers.set('x-elogbook-env', 'supabase-url-invalid');
      return degraded;
    }
    return NextResponse.next({ request });
  }

  // P1.5: CSRF guard for state-changing requests (POST/PUT/DELETE/PATCH)
  const csrfResponse = csrfGuard(request);
  if (csrfResponse) return csrfResponse;

  const { url, key } = env;

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Don't run session logic on the home page or static assets —
  // those are public and don't need a Supabase round-trip.
  const pathname = request.nextUrl.pathname;
  const isHomePage = pathname === '/';
  const isLoginPage = pathname === '/login' || pathname.startsWith('/login/');
  const isAuthRoute = pathname.startsWith('/auth');
  // /onboarding and /mfa are top-level, self-guarding flows that the
  // authenticated layout redirects INTO — treating them as tenant-scoped
  // routes would bounce them back and create a redirect loop.
  const isOnboardingRoute = pathname === '/onboarding' || pathname.startsWith('/onboarding/');
  const isMfaRoute = pathname === '/mfa' || pathname.startsWith('/mfa/');
  // Public marketing/support surface: the signup funnel (pricing →
  // signup), the contact-sales page, and the swagger API docs must render
  // for anonymous visitors. The public API endpoints (health check, contact
  // form, SSO probe, auth) must answer JSON instead of redirecting to
  // /login — a healthcheck that bounces to the login page breaks uptime
  // monitoring.
  const isPricingRoute = pathname === '/pricing' || pathname.startsWith('/pricing/');
  const isSignupRoute = pathname === '/signup' || pathname.startsWith('/signup/');
  const isContactRoute = pathname === '/contact' || pathname.startsWith('/contact/');
  const isApiDocsRoute = pathname === '/api-docs' || pathname.startsWith('/api-docs/');
  const isPublicApiRoute =
    pathname === '/api/health' || pathname === '/api/ready' || pathname === '/api/contact' || pathname === '/api/sso/check' ||
    pathname.startsWith('/api/auth');
  const isPublicRoute =
    isHomePage || isLoginPage || isAuthRoute || isOnboardingRoute || isMfaRoute ||
    isPricingRoute || isSignupRoute || isContactRoute || isApiDocsRoute || isPublicApiRoute;

  // Only call getUser() for non-public routes (saves a network
  // round-trip on every static page load).
  if (isPublicRoute) {
    // For /login specifically, check if user is already logged in
    // and redirect to their dashboard. For other public routes,
    // just pass through.
    if (isLoginPage) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const info = await getUserTenantSlug(supabase, user.id);
          const slug = info?.slug ?? 'default';
          return NextResponse.redirect(new URL(`/${slug}/dashboard`, request.url));
        }
      } catch {
        // If getUser() fails (e.g. no session cookie), just show /login
      }
    }
    return supabaseResponse;
  }

  // Non-public route: check auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  // User is authenticated — check tenant scope.
  // API routes carry their own auth (per-route getAuthContext / service
  // checks); their first path segment is literally "api", which would
  // always mismatch the tenant slug and 307 every cookie-authenticated
  // API mutation to the dashboard. Skip scope enforcement here — the
  // handlers enforce tenant scoping themselves (and RLS backstops it).
  const segments = pathname.split('/').filter(Boolean);
  // T17: /platform is the operator area, never a tenant slug. Auth is still
  // required above; the platform layout enforces registry authority itself.
  if (!pathname.startsWith('/api/') && segments[0] !== 'platform') {
    const urlTenantSlug = segments[0];

    if (urlTenantSlug) {
      const info = await getUserTenantSlug(supabase, user.id);
      // Fail closed: a missing profile/tenant used to skip this check
      // entirely, letting a user walk into any tenant's URL. No identity
      // mapping means no tenant access.
      if (!info) {
        return NextResponse.redirect(new URL('/login', request.url));
      }
      if (info.slug !== urlTenantSlug) {
        return NextResponse.redirect(
          new URL(`/${info.slug || 'default'}/dashboard`, request.url),
        );
      }
    }
  }

  const isAdminRoute =
    segments[1] === 'admin' || (segments[0] === 'api' && segments[2] === 'admin');
  if (isAdminRoute) {
    const { data: { session } } = await supabase.auth.getSession();
    if ((session as { aal?: string } | null)?.aal && (session as { aal?: string } | null)?.aal !== 'aal2') {
      try {
        const { data: mfaData } = await supabase.auth.mfa.listFactors();
        const hasVerifiedMfa =
          mfaData?.all?.some((f) => f.status === 'verified') ?? false;
        if (hasVerifiedMfa) {
          const verifyUrl = new URL('/mfa/verify', request.url);
          verifyUrl.searchParams.set('next', pathname + request.nextUrl.search);
          return NextResponse.redirect(verifyUrl);
        }
      } catch {
        // MFA API not available
      }
    }
  }

  return supabaseResponse;
}