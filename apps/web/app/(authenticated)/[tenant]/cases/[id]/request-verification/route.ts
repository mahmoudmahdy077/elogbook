import { createServerSupabase } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { allowed, retryAfter } = await checkRateLimit(`request-verification:${user.id}:${id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const { data: entry } = await supabase
    .from('case_entries')
    .select('id, tenant_id, resident_id, status')
    .eq('id', id)
    .single();

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.status !== 'approved') {
    return NextResponse.json({ error: 'Only approved cases can request verification' }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name')
    .eq('user_id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
  if (entry.resident_id !== profile.id) {
    return NextResponse.json({ error: 'You can only request verification for your own cases' }, { status: 403 });
  }

  const { data: existingRequest } = await supabase
    .from('approval_requests')
    .select('id')
    .eq('entry_id', id)
    .maybeSingle();

  if (existingRequest) {
    return NextResponse.json({ error: 'Verification already requested for this case' }, { status: 400 });
  }

  const { data: supervisors } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', entry.tenant_id)
    .in('role', ['supervisor', 'director'])
    .limit(50);

  if (!supervisors || supervisors.length === 0) {
    return NextResponse.json({ error: 'No supervisors or directors available for verification' }, { status: 400 });
  }

  const { error: insertError } = await supabase.from('approval_requests').insert(
    supervisors.map((s: { id: string }) => ({
      tenant_id: entry.tenant_id,
      entry_id: id,
      supervisor_id: s.id,
      status: 'pending',
      comment: `Verification requested by ${profile.full_name || 'resident'}`,
    }))
  );

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: 'Verification request sent to supervisors' });
}
