import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: paramTenant } = await params;

  const { allowed, retryAfter } = checkRateLimit(`export-pdf:${paramTenant}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = (profile.tenants as { slug: string }[])[0];
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
    const { data: pdfResponse, error } = await supabase.functions.invoke('generate-pdf', {
      body: {
        case_ids: cases.map((c: { id: string }) => c.id),
        resident_name: profile.full_name,
        tenant: paramTenant,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!pdfResponse) {
      return NextResponse.json({ error: 'No response from PDF generator' }, { status: 502 });
    }

    const contentType = pdfResponse?.headers?.['content-type'] ?? 'text/html';

    return new NextResponse(pdfResponse, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="elogbook-report-${paramTenant}.pdf"`,
      },
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'PDF generation timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
