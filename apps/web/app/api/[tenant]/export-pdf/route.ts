import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: paramTenant } = await params;
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

  const tenant = profile.tenants as unknown as { slug: string };
  if (tenant.slug !== paramTenant) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  const { data: cases } = await supabase
    .from('case_entries')
    .select('case_date, patient_mrn, case_templates!inner(name, specialty)')
    .eq('tenant_id', profile.tenant_id)
    .eq('resident_id', profile.id)
    .eq('status', 'approved')
    .order('case_date', { ascending: false });

  if (!cases || cases.length === 0) {
    return NextResponse.json({ error: 'No approved cases to export' }, { status: 404 });
  }

  const caseData = cases.map((c: any) => ({
    case_date: c.case_date,
    patient_mrn: c.patient_mrn,
    specialty: c.case_templates?.specialty ?? '',
    name: c.case_templates?.name ?? '',
  }));

  const { data: pdfResponse, error } = await supabase.functions.invoke('generate-pdf', {
    body: {
      cases: caseData,
      resident_name: profile.full_name,
      tenant: paramTenant,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const contentType = pdfResponse?.headers?.['content-type'] ?? 'text/html';

  return new NextResponse(pdfResponse, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="elogbook-report-${paramTenant}.pdf"`,
    },
  });
}
