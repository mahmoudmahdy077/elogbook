import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/[tenant]/reports/gap-analysis
 * Body: { resident_id: string }
 *
 * Competency gap analysis for a single resident. Proxies the
 * `ai-gap-analysis` Supabase Edge Function with the caller's JWT so the
 * edge-side role gate (supervisor+) and RLS apply.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  // ---- CSRF (state-changing) + rate limit ----
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const { allowed, retryAfter } = await checkRateLimit(`gap-analysis:${ip}`, 20);
  if (!allowed) return rateLimitResponse(retryAfter);

  // ---- Auth ----
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as unknown as { slug: string };
  const { tenant: paramTenant } = await params;
  if (tenant.slug !== paramTenant) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  // ---- Input validation ----
  let body: { resident_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const residentId = typeof body.resident_id === 'string' ? body.resident_id : '';
  if (!UUID_RE.test(residentId)) {
    return NextResponse.json({ error: 'resident_id (UUID) required' }, { status: 400 });
  }

  // The target resident must belong to the caller's tenant.
  const { data: targetResident } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', residentId)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();
  if (!targetResident) {
    return NextResponse.json({ error: 'Resident not found in this tenant' }, { status: 404 });
  }

  // ---- Proxy to the edge function with the user's JWT ----
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20_000);

  try {
    const fnUrl = `${supabaseUrl}/functions/v1/ai-gap-analysis`;
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken ?? anonKey}`,
      },
      body: JSON.stringify({ resident_id: residentId }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const payload = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: payload || `Edge function ${res.status}` },
        { status: res.status >= 500 ? 502 : res.status },
      );
    }

    return new NextResponse(payload, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Gap analysis timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Failed to run gap analysis' }, { status: 500 });
  }
}
