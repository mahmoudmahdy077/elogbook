import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import type { UserRole } from '@/lib/supabase/auth';

const ALLOWED_ROLES: UserRole[] = ['director', 'institution_admin', 'admin'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/[tenant]/reports/webads?date_from=&date_to=
 *
 * ACGME WebADS XML export for the whole tenant. Proxies the
 * `webads-export` Supabase Edge Function with the caller's JWT so the
 * edge-side auth + RLS apply. Director+ only (WebADS is a program-level
 * accreditation submission).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  // ---- Rate limit by IP (10 req/min, same tier as audit export) ----
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const { allowed, retryAfter } = await checkRateLimit(`webads-export:${ip}`, 10);
  if (!allowed) return rateLimitResponse(retryAfter);

  // ---- Auth ----
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
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
  if (!ALLOWED_ROLES.includes(profile.role as UserRole)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // ---- Date range validation (optional params) ----
  const url = new URL(request.url);
  const dateFrom = url.searchParams.get('date_from') || undefined;
  const dateTo = url.searchParams.get('date_to') || undefined;
  if ((dateFrom && !ISO_DATE_RE.test(dateFrom)) || (dateTo && !ISO_DATE_RE.test(dateTo))) {
    return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 });
  }

  // ---- Resolve tenant residents (edge fn filters on these ids) ----
  const { data: residents } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'resident');

  const residentIds = (residents ?? []).map((r: { id: string }) => r.id);
  if (residentIds.length === 0) {
    return NextResponse.json({ error: 'No residents found for this tenant' }, { status: 404 });
  }

  // ---- Proxy to the edge function with the user's JWT ----
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const fnUrl = `${supabaseUrl}/functions/v1/webads-export`;
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken ?? anonKey}`,
      },
      body: JSON.stringify({
        tenant_id: profile.tenant_id,
        resident_ids: residentIds,
        ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(dateTo ? { date_to: dateTo } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Edge function ${res.status}: ${text}`.slice(0, 300) },
        { status: res.status >= 500 ? 502 : res.status },
      );
    }

    const xml = await res.text();
    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml',
        'Content-Disposition': `attachment; filename="webads-export-${paramTenant}.xml"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'WebADS export timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Failed to generate WebADS export' }, { status: 500 });
  }
}
