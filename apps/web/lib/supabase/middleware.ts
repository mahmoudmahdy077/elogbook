import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

function getEnvVars() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable.');
  }
  if (!key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable.');
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
  const { url, key } = getEnvVars();

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === '/login' || pathname.startsWith('/login/');
  const isAuthRoute = pathname.startsWith('/auth');
  const isPublicRoute = isLoginPage || isAuthRoute;

  if (!user && !isPublicRoute) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isLoginPage) {
    const info = await getUserTenantSlug(supabase, user.id);
    const slug = info?.slug ?? 'default';
    return NextResponse.redirect(new URL(`/${slug}/dashboard`, request.url));
  }

  if (user && !isPublicRoute) {
    const segments = pathname.split('/').filter(Boolean);
    const urlTenantSlug = segments[0];

    if (urlTenantSlug) {
      const info = await getUserTenantSlug(supabase, user.id);
      if (info && info.role !== 'admin' && info.slug !== urlTenantSlug) {
        return NextResponse.redirect(
          new URL(`/${info.slug}/dashboard`, request.url),
        );
      }
    }
  }

  return supabaseResponse;
}