import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * UX2-018: PHI reveal endpoint for case detail.
 *
 * The case detail page renders patient_mrn / patient_dob MASKED ONLY — the
 * full values are never included in the RSC payload. This endpoint returns
 * them on explicit user request, writing an immutable `phi_view` audit-log
 * row first (audit_logs blocks authenticated INSERTs by design, migration
 * 00012, so the write goes through the service-role client after the
 * caller's access has already been verified against the RLS-bound read).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;

  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { allowed, retryAfter } = await checkRateLimit(`phi-reveal:${user.id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as unknown as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  // RLS-bound read: same-tenant visibility only (mirrors the page's access
  // checks; residents additionally see only their own entries).
  const { data: entry } = await supabase
    .from('case_entries')
    .select('id, tenant_id, resident_id, is_deidentified, patient_mrn, patient_dob')
    .eq('id', id)
    .single();

  if (!entry) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const isResident = profile.role === 'resident';
  if (isResident && entry.resident_id !== profile.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // De-identified cases carry no PHI — nothing to reveal, no audit row.
  if (entry.is_deidentified || (!entry.patient_mrn && !entry.patient_dob)) {
    return NextResponse.json({ mrn: null, dob: null, revealed: false });
  }

  const adminClient = createServiceRoleClient();
  const { error: auditError } = await adminClient.from('audit_logs').insert({
    tenant_id: entry.tenant_id,
    user_id: user.id,
    action: 'phi_view',
    resource_type: 'case_entry',
    resource_id: id,
    changes: { fields: ['patient_mrn', 'patient_dob'] },
  });

  if (auditError) {
    return NextResponse.json({ error: 'Failed to record audit' }, { status: 500 });
  }

  return NextResponse.json({
    mrn: entry.patient_mrn,
    dob: entry.patient_dob,
    revealed: true,
  });
}
