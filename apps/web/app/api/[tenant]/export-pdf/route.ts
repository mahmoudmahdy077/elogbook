import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: paramTenant } = await params;

  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { allowed, retryAfter } = await checkRateLimit(`export-pdf:${user.id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== paramTenant) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  const { data: cases } = await supabase
    .from('case_entries')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('resident_id', profile.id)
    .eq('status', 'approved')
    .order('case_date', { ascending: false });

  if (!cases || cases.length === 0) {
    return NextResponse.json({ error: 'No approved cases to export' }, { status: 404 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    // P4.6: use the supabase-js client's session to call the edge
    // function URL directly so we get a raw binary response. The
    // `functions.invoke()` helper parses JSON, which would corrupt a
    // PDF payload. We use the anon key + user access token as bearer.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess.session?.access_token;

    const fnUrl = `${supabaseUrl}/functions/v1/generate-pdf`;
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken ?? anonKey}`,
      },
      body: JSON.stringify({
        case_ids: cases.map((c: { id: string }) => c.id),
        resident_name: profile.full_name,
        tenant: paramTenant,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Edge function ${res.status}: ${text}` },
        { status: res.status >= 500 ? 502 : res.status },
      );
    }

    const contentType = res.headers.get('content-type') ?? 'application/pdf';
    const arrayBuffer = await res.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="elogbook-report-${paramTenant}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'PDF generation timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
