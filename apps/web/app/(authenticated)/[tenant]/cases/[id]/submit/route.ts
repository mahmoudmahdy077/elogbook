import { createServerSupabase } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { notifyPendingApproval } from '@/lib/notifications';
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
  _span: Sentry.Span | undefined
) {

  const { tenant: tenantSlug, id } = params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // P1.6: Tenant-slug URL validation — ensure the slug in the URL matches
  // the authenticated user's tenant before processing the submission.
  // This is a defense-in-depth check; the middleware also validates tenant
  // scope for all protected routes.
  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (callerProfile) {
    const callerTenant = callerProfile.tenants as unknown as { slug: string } | null;
    if (callerTenant && callerTenant.slug !== tenantSlug) {
      return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
    }
  }

  const { allowed, retryAfter } = await checkRateLimit(`cases-submit:${user.id}:${id}`);
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
    .select('id, role, full_name')
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

  // The draft -> submitted transition lives in a SECURITY DEFINER RPC so a
  // client cannot set status='approved' directly and skip the ownership and
  // subscription checks (or the case.submitted webhook below).
  const { data: submitResult, error: updateError } = await supabase.rpc('submit_case', {
    p_entry_id: id,
  });

  if (updateError) {
    const message = updateError.message ?? 'Could not submit the case.';
    const status = /not a draft|not found/i.test(message) ? 409 : /lapsed/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const result = (submitResult ?? {}) as { status?: string; auto_approved?: boolean };

  const { data: tenant } = await supabase
    .from('tenants')
    .select('tenant_type')
    .eq('id', entry.tenant_id)
    .single();

  if (tenant?.tenant_type === 'individual' || result.auto_approved) {
    return NextResponse.json({ success: true, auto_approved: true });
  }

  const { data: supervisors } = await supabase
    .from('profiles')
    .select('id')
    .eq('tenant_id', entry.tenant_id)
    .in('role', ['supervisor', 'director'])
    .limit(50);

  if (supervisors && supervisors.length > 0) {
    const { error: approvalError } = await supabase.from('approval_requests').insert(
      supervisors.map((s: { id: string }) => ({
        tenant_id: entry.tenant_id,
        entry_id: id,
        supervisor_id: s.id,
        status: 'pending',
      }))
    );

    if (approvalError) {
      // The approvals queue reads status='pending' (since #26), so the case is
      // still reviewable. Do not try to revert: pending -> draft is not a
      // legal transition and the old revert always failed.
      console.error('[cases/submit] approval_requests insert failed:', approvalError.message);
    }
  }

  // Fire webhook event after successful case submission
  dispatchWebhookEvent({
    tenant_id: entry.tenant_id,
    event_type: 'case.submitted',
    event_id: id,
    data: { entry_id: id, resident_id: entry.resident_id },
  }).catch((err) => {
    console.error('[webhooks] Submit dispatch error:', err);
  });

  // Push notification to supervisors (fire-and-forget; failures are logged).
  if (supervisors && supervisors.length > 0) {
    for (const s of supervisors) {
      notifyPendingApproval(id, s.id, profile.full_name || 'A resident')
        .catch((err) => console.error('[push] pending-approval push failed:', err));
    }
  }

  return NextResponse.json({ success: true });
}
