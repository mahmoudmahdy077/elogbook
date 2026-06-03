import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(
  _request: Request,
  { params }: { params: { tenant: string; id: string } }
) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as unknown as { slug: string; tenant_type: string };
  if (tenant.slug !== params.tenant) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: entry, error: entryError } = await supabase
    .from('case_entries')
    .select('id, status')
    .eq('id', params.id)
    .single();

  if (entryError || !entry) {
    return NextResponse.json({ error: 'Case entry not found' }, { status: 404 });
  }

  if (entry.status !== 'draft') {
    return NextResponse.json({ error: 'Only draft entries can be submitted' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('case_entries')
    .update({ status: 'pending' })
    .eq('id', params.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (tenant.tenant_type === 'individual') {
    return NextResponse.json({ success: true, auto_approved: true });
  }

  const { data: supervisors, error: supervisorsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .in('role', ['supervisor', 'director']);

  if (supervisorsError) {
    return NextResponse.json({ error: supervisorsError.message }, { status: 500 });
  }

  if (supervisors && supervisors.length > 0) {
    const approvalRequests = supervisors.map((sup) => ({
      entry_id: params.id,
      supervisor_id: sup.id,
      status: 'pending',
    }));

    const { error: approvalError } = await supabase
      .from('approval_requests')
      .insert(approvalRequests);

    if (approvalError) {
      return NextResponse.json({ error: approvalError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
