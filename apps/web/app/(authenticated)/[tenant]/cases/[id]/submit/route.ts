import { createServerSupabase } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  // P6.3: custom span around the case-submit hot path. Wraps the
  // CSRF, rate-limit, ownership, and approval-creation logic so the
  // trace shows the real production p95 in Sentry Performance.
  return await Sentry.startSpan(
    { name: 'cases.submit', op: 'http.server' },
    async (span) => {
      const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
      if (csrfError) {
        span?.setAttribute('csrf.failed', true);
        return csrfError;
      }
      return await handleSubmit(request, await params, span);
    }
  );
}

async function handleSubmit(
  request: Request,
  params: { tenant: string; id: string },
  span: Sentry.Span | undefined
) {

  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { allowed, retryAfter } = checkRateLimit(`cases-submit:${user.id}:${id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const { data: entry } = await supabase
    .from('case_entries')
    .select('id, tenant_id, resident_id, status')
    .eq('id', id)
    .single();

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (entry.status !== 'draft') return NextResponse.json({ error: 'Can only submit drafts' }, { status: 400 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('user_id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 403 });

  const isOwner = entry.resident_id === profile.id;
  const isPrivileged = ['supervisor', 'director', 'institution_admin', 'admin'].includes(profile.role);
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: 'You can only submit your own draft cases' }, { status: 403 });
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('tenant_id', entry.tenant_id)
    .maybeSingle();

  if (subscription?.status === 'past_due' || subscription?.status === 'unpaid') {
    return NextResponse.json({ error: 'Subscription lapsed — case submission disabled' }, { status: 403 });
  }

  const { error: updateError } = await supabase
    .from('case_entries')
    .update({ status: 'pending' })
    .eq('id', id);

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
    const { error: approvalError } = await supabase.from('approval_requests').insert(
      supervisors.map((s) => ({
        tenant_id: entry.tenant_id,
        entry_id: id,
        supervisor_id: s.id,
        status: 'pending',
      }))
    );

    if (approvalError) {
      await supabase
        .from('case_entries')
        .update({ status: 'draft' })
        .eq('id', id);
      return NextResponse.json({
        error: 'Failed to create approval requests. Case has been returned to draft.',
      }, { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  return NextResponse.json({ success: true });
}
