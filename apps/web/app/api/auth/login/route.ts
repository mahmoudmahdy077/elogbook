import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getProjectRef(): string {
  if (!SUPABASE_URL) return '';
  try {
    const hostname = new URL(SUPABASE_URL).hostname;
    return hostname.split('.')[0];
  } catch {
    return '';
  }
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 },
      );
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error('[API /auth/login] Missing Supabase env vars');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 },
      );
    }

    // Direct fetch to Supabase GoTrue API (bypasses client SDK issues)
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const authData = await authResponse.json();

    if (!authResponse.ok) {
      const message = authData.error_description || authData.msg || 'Authentication failed';
      return NextResponse.json({ error: message }, { status: authResponse.status });
    }

    // Get tenant info
    const profileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=role,tenants!inner(slug)&user_id=eq.${authData.user.id}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${authData.access_token}`,
        },
      },
    );

    const profiles = await profileResponse.json();
    const profile = profiles?.[0];
    const slug = profile?.tenants?.slug ?? 'demo';
    const redirectUrl = `/${slug}/dashboard`;

    // Set session cookies in the format expected by @supabase/ssr
    // Cookie name: sb-<project-ref>-auth-token
    const projectRef = getProjectRef();
    const cookieName = projectRef ? `sb-${projectRef}-auth-token` : 'sb-auth-token';

    const sessionData = JSON.stringify({
      access_token: authData.access_token,
      refresh_token: authData.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + authData.expires_in,
      expires_in: authData.expires_in,
      token_type: 'bearer',
      user: authData.user,
    });

    const response = NextResponse.json({
      user: {
        id: authData.user.id,
        email: authData.user.email,
        role: authData.app_metadata?.user_role,
      },
      redirectUrl,
    });

    response.cookies.set(cookieName, sessionData, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (err) {
    console.error('[API /auth/login] Error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Internal server error', detail },
      { status: 500 },
    );
  }
}
