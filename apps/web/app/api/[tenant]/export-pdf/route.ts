import { createServerSupabase } from '@/lib/supabase/server';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { isUuid } from '@/lib/audit/audit-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The PDF report is produced by the `generate-pdf` edge function under the
 * documented single-resident supervisor scope: an AAL2 supervisor, director,
 * institution_admin or admin of the tenant asks for exactly one resident, and
 * the edge function independently re-authorizes the request, narrows it to that
 * resident's approved, non-deleted cases, resolves the resident label
 * server-side and writes the required audit event before releasing the
 * document.
 *
 * This route is therefore a scoped proxy: it never forwards a caller-supplied
 * resident name, and it never echoes the edge function's body (which can carry
 * database detail) back to the browser.
 */
const PDF_SCOPE_ROLES = ['supervisor', 'director', 'institution_admin', 'admin'] as const;
const MAX_PDF_CASES = 100;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: paramTenant } = await params;

  const supabase = await createServerSupabase();
  const security = await getSecurityContext(supabase, { requiredAal: 'aal2' });
  if (!security.ok) {
    return NextResponse.json(
      { error: security.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: security.status },
    );
  }

  const { allowed, retryAfter } = await checkRateLimit(`export-pdf:${security.context.user.id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const { profile, tenant } = security.context;
  if (tenant.slug !== paramTenant) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!(PDF_SCOPE_ROLES as readonly string[]).includes(profile.role)) {
    return NextResponse.json(
      { error: 'Only supervisors and directors can export a case report' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const residentId = searchParams.get('resident_id') ?? '';
  if (!residentId) {
    return NextResponse.json(
      { error: 'resident_id is required: a case report covers exactly one resident' },
      { status: 400 },
    );
  }
  if (!isUuid(residentId)) {
    return NextResponse.json({ error: 'resident_id is not a valid identifier' }, { status: 400 });
  }

  const { data: cases } = await supabase
    .from('case_entries')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('resident_id', residentId)
    .eq('status', 'approved')
    .is('deleted_at', null)
    .order('case_date', { ascending: false })
    .limit(MAX_PDF_CASES);

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
        resident_id: residentId,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      // The edge function's body can contain database detail, so it is never
      // forwarded to the browser.
      const status = res.status === 403 || res.status === 404 || res.status === 400 ? res.status : 502;
      return NextResponse.json(
        { error: status === 502 ? 'Failed to generate the case report' : 'The case report request was rejected' },
        { status },
      );
    }

    const contentType = res.headers.get('content-type') ?? 'application/pdf';
    const arrayBuffer = await res.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="elogbook-report-${paramTenant}.pdf"`,
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
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
