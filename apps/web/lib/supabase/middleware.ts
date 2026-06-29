import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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