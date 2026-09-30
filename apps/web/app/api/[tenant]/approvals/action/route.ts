import { createServerSupabase } from '@/lib/supabase/server';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { runAfterResponse } from '@/lib/after-response';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { notifyCaseApproval } from '@/lib/notifications';
import { logger } from '@/lib/logger';
import { clinicalCommandLog, correlationHeaders, resolveCorrelationId } from '@/lib/observability/correlation-id';

const ALLOWED_ROLES = ['supervisor', 'director', 'institution_admin', 'admin'];
const approvalActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  entry_id: z.string().min(1).max(128),
  // Mandatory so a retried decision replays the stored result instead of
  // re-applying an approval.
  request_id: z.string().trim().min(1).max(128),
  comment: z.string().max(2000).optional(),
}).strict();

const CODE_STATUS: Record<string, number> = {
  invalid_request: 400,
  forbidden: 403,
  account_inactive: 403,
  tenant_suspended: 403,
  no_approval_request: 403,
  not_found: 404,
  state_conflict: 409,
  idempotency_conflict: 409,
  internal_error: 500,
};

const CODE_MESSAGE: Record<string, string> = {
  invalid_request: 'Invalid request body',
  forbidden: 'You are not allowed to decide this case',
  account_inactive: 'Your account is not active',
  tenant_suspended: 'This program is not active',
  no_approval_request: 'No open approval request exists for this case.',
  not_found: 'Case not found',
  state_conflict: 'This case has already been decided. Reload to see its current state.',
  idempotency_conflict: 'This request key was already used with different input.',
  internal_error: 'Could not record this decision. Please try again.',
};

/**
 * P1.4 + P1.5: API route for approval actions (approve/reject) with
 * rate limiting (20 req/min per IP) and CSRF origin validation.
 *
 * The old ApprovalActions component called supabase.rpc() directly from
 * the client. This route adds server-side enforcement so the RPC is
 * only invoked after auth, CSRF, and rate-limit checks pass.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, approvalActionSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 8 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  // ---- Rate limit by IP (20 req/min) ----
  const ip = getClientIp(request);

  const { allowed, retryAfter } = await checkRateLimit(`approve-action:${ip}`, 20);
  if (!allowed) return rateLimitResponse(retryAfter);

  // ---- Auth and server-side AAL2 ----
  const supabase = await createServerSupabase();
  const security = await getSecurityContext(supabase, { requiredAal: 'aal2' });
  if (!security.ok) {
    const error = security.reason === 'aal2_required'
      ? 'Re-authentication with MFA required'
      : security.reason === 'unauthenticated' || security.reason === 'session_required' || security.reason === 'session_unavailable'
        ? 'Unauthorized'
        : security.reason === 'profile_not_found'
          ? 'Profile not found'
          : security.reason === 'tenant_not_found'
            ? 'Tenant not found'
            : 'Security context unavailable';
    return NextResponse.json({ error }, { status: security.status });
  }

  const { user, profile, tenant } = security.context;
  const { tenant: tenantSlug } = await params;

  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json(
      { error: 'Only supervisors and directors can perform approval actions' },
      { status: 403 },
    );
  }

  const { action, entry_id: entryId, request_id: requestId, comment } = guarded.data;

  // ---- Ensure the entry belongs to the same tenant ----
  const { data: entry } = await supabase
    .from('case_entries')
    .select('id, tenant_id, resident_id, status')
    .eq('id', entryId)
    .single();

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  if (entry.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Entry does not belong to your tenant' }, { status: 403 });
  }

  // ---- Call the AAL2-gated clinical command ----
  // The database owns the transition, the approval-request resolution, the
  // audit row and the outbox row. This route never writes case status.
  //
  // The correlation id is server-derived. The client-supplied `request_id` is
  // an idempotency key only and is never used as the correlation id.
  const correlationId = resolveCorrelationId(request.headers);
  const startedAt = Date.now();
  const logClinical = (resultCode: string) =>
    logger.info('clinical command', clinicalCommandLog({
      command: 'decide_case',
      caseId: entryId,
      tenantId: profile.tenant_id,
      durationMs: Date.now() - startedAt,
      resultCode,
      correlationId,
    }));

  const { data: rpcData, error: rpcError } = await supabase.rpc('decide_case_command', {
    p_case_id: entryId,
    p_request_id: requestId,
    p_decision: action,
    p_reason: comment || null,
  });

  if (rpcError) {
    logger.error('decide_case command failed', rpcError, { entryId, correlationId });
    logClinical('internal_error');
    return NextResponse.json(
      { error: CODE_MESSAGE.internal_error, success: false, code: 'internal_error' },
      { status: 500, headers: correlationHeaders(correlationId) },
    );
  }

  const rpcResult = (rpcData ?? {}) as Record<string, unknown>;
  if (rpcResult.success !== true) {
    const code = typeof rpcResult.code === 'string' && rpcResult.code in CODE_STATUS
      ? rpcResult.code
      : 'internal_error';
    logClinical(code);
    return NextResponse.json(
      { error: CODE_MESSAGE[code], success: false, code },
      { status: CODE_STATUS[code], headers: correlationHeaders(correlationId) },
    );
  }

  logClinical(action === 'approve' ? 'approved' : 'rejected');

  const approved = action === 'approve';
  const { data: residentAuth, error: residentAuthError } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('id', entry.resident_id)
    .single();

  if (residentAuthError) {
    logger.error('Failed to resolve approval notification recipient', residentAuthError, { entryId });
  } else if (residentAuth?.user_id) {
    const { error: notificationError } = await supabase.from('notifications').insert({
      tenant_id: profile.tenant_id,
      user_id: residentAuth.user_id,
      type: 'approval',
      title: `Case ${approved ? 'approved' : 'rejected'}`,
      body: `Your case was ${approved ? 'approved' : 'rejected'}. Open the case to review the decision.`,
      link: `/${tenantSlug}/cases/${entryId}`,
    });
    if (notificationError) {
      logger.error('Failed to persist approval notification', notificationError, { entryId });
    }
  }

  // Post-response work is scheduled durably through runAfterResponse (Next's
  // `after()`), never as an unawaited fire-and-forget promise: a bare promise
  // in a route handler is frozen when the response returns, which silently
  // killed webhook deliveries in production.
  runAfterResponse(
    () => dispatchWebhookEvent({
      tenant_id: profile.tenant_id,
      event_type: action === 'approve' ? 'case.approved' : 'case.rejected',
      event_id: entryId,
      // Opaque metadata only. The approval comment is a free-text clinical note
      // and must never reach a vendor webhook.
      data: { entry_id: entryId, actor_id: user.id, status: approved ? 'approved' : 'rejected' },
    }),
    { label: 'approval-webhook', onError: (err) => logger.error('Failed to dispatch approval webhook', err, { entryId }) },
  );

  // Push notification to the resident (post-response; failures are logged).
  runAfterResponse(
    () => notifyCaseApproval(entryId, entry.resident_id, approved ? 'approved' : 'rejected'),
    {
      label: 'approval-push',
      onError: (err) => logger.error('Failed to send approval push notification', err, { entryId }),
    },
  );

  // Email fallback when no push token (best-effort; never fails the approval).
  // Resolves resident email via service-role auth lookup; skips silently if unresolvable.
  try {
    const { data: prof } = await supabase.from('profiles').select('user_id').eq('id', entry.resident_id).maybeSingle();
    const profUserId = (prof as { user_id?: string } | null)?.user_id;
    const { data: tokens } = profUserId ? await supabase.from('push_tokens').select('token').eq('user_id', profUserId).eq('active', true).limit(1) : { data: [] as { token: string }[] };
    if (!tokens?.length && profUserId) {
      const serviceRole = createServiceRoleClient();
      const { data: authUser } = await serviceRole.auth.admin.getUserById(profUserId);
      const residentEmail = authUser?.user?.email?.toLowerCase();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') || '';
      if (residentEmail && siteUrl) {
        await serviceRole.from('email_queue').insert({
          template_key: approved ? 'case.approved' : 'case.rejected',
          to_email: residentEmail,
          tenant_id: profile.tenant_id,
          payload: { case_url: `${siteUrl}/${tenantSlug}/cases/${entryId}` },
          priority: 5,
        });
      }
    }
  } catch { /* email fallback is best-effort */ }

  return NextResponse.json(
    { success: true, action },
    { headers: correlationHeaders(correlationId) },
  );
}
