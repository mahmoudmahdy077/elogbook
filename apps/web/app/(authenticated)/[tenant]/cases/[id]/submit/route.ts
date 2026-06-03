import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: entry } = await supabase
    .from('case_entries')
    .select('id, tenant_id, status')
    .eq('id', params.id)
    .single();

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.status !== 'draft') return NextResponse.json({ error: 'Can only submit drafts' }, { status: 400 });

  const { error: updateError } = await supabase
    .from('case_entries')
    .update({ status: 'pending' })
    .eq('id', params.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const { data: tenant } = await supabase
    .from('tenants')
    .select('tenant_type')
    .eq('id', entry.tenant_id)
    .single();

  if (tenant?.tenant_type === 'individual') {
    return NextResponse.json({ success: true, auto_approved: true });
  }

  const { data: supervisors } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', entry.tenant_id)
    .in('role', ['supervisor', 'director']);

  if (supervisors && supervisors.length > 0) {
    await supabase.from('approval_requests').insert(
      supervisors.map((s) => ({
        entry_id: params.id,
        supervisor_id: s.id,
        status: 'pending',
      }))
    );
  }

  return NextResponse.json({ success: true });
}
