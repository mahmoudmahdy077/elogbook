import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const requestOrigin = origin ?? (referer ? new URL(referer).origin : null);

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

function getEnvVars(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Don't crash — just return null so the proxy can pass through
    // without trying to refresh the session. This allows the app to
    // at least serve the home page and /login even before env vars
    // are configured in Vercel.
    return null;
  }
  return { url, key };
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

  const tenants = data.tenants as { slug: string } | null;
  return { slug: tenants?.slug ?? '', role: data.role };
}

export async function updateSession(request: NextRequest) {
  const env = getEnvVars();

  // If Supabase env vars aren't configured, just pass the request
  // through without session management. The page-level auth checks
  // will redirect to /login as needed.
  if (!env) {
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
  const isPublicRoute = isHomePage || isLoginPage || isAuthRoute;

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

  // User is authenticated — check tenant scope
  const segments = pathname.split('/').filter(Boolean);
  const urlTenantSlug = segments[0];

  if (urlTenantSlug) {
    const info = await getUserTenantSlug(supabase, user.id);
    if (info && info.slug !== urlTenantSlug) {
      return NextResponse.redirect(
        new URL(`/${info.slug}/dashboard`, request.url),
      );
    }
  }

  return supabaseResponse;
}