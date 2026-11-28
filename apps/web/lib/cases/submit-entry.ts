/**
 * Single case-submit implementation shared by the cookie-authenticated web
 * route and the bearer-authenticated mobile API.
 *
 * Extracted from `app/(authenticated)/[tenant]/cases/[id]/submit/route.ts`
 * so the Expo app cannot drift from the web: both paths run the same draft
 * check, ownership/subscription gate, `submit_case` RPC, supervisor approval
 * rows, webhook and push notification.
 *
 * The caller owns authentication and rate limiting. This function only
 * applies the case-level rules against the authenticated `supabase` client,
 * so RLS and the SECURITY DEFINER RPC remain the authority.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchWebhookEvent } from '@/lib/webhooks';
import { notifyPendingApproval } from '@/lib/notifications';

export interface SubmitResult {
  status: number;
  body: Record<string, unknown>;
}

export async function submitDraftEntry(
  supabase: SupabaseClient,
  user: { id: string },
  entryId: string,
): Promise<SubmitResult> {
  const { data: entry } = await supabase
    .from('case_entries')
    .select('id, tenant_id, resident_id, status')
    .eq('id', entryId)
    .single();

  if (!entry) return { status: 404, body: { error: 'Not found' } };
  if (entry.status !== 'draft') {
    return { status: 400, body: { error: 'Can only submit drafts' } };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, status')
    .eq('user_id', user.id)
    .single();

  if (!profile) return { status: 403, body: { error: 'Profile not found' } };

  // A still-valid access token outlives a deactivation for up to an hour.
  // Check the account state on every submit, not just at sign-in.
  if (profile.status != null && profile.status !== 'active') {
    return { status: 403, body: { error: 'Account is not active' } };
  }

  const isOwner = entry.resident_id === profile.id;
  const isPrivileged = ['supervisor', 'director', 'institution_admin', 'admin'].includes(
    profile.role,
  );
  if (!isOwner && !isPrivileged) {
    return { status: 403, body: { error: 'You can only submit your own draft cases' } };
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('tenant_type, status')
    .eq('id', entry.tenant_id)
    .single();

  // Check before the RPC: once submit_case runs the draft is already pending,
  // so a late refusal would report failure on a real state change.
  if (
    tenant &&
    (tenant as { status?: string | null }).status != null &&
    (tenant as { status?: string | null }).status !== 'active'
  ) {
    return { status: 403, body: { error: 'Tenant is not active' } };
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('tenant_id', entry.tenant_id)
    .maybeSingle();

  if (subscription?.status === 'past_due' || subscription?.status === 'unpaid') {
    return { status: 403, body: { error: 'Subscription lapsed — case submission disabled' } };
  }

  // The draft -> submitted transition lives in a SECURITY DEFINER RPC so a
  // client cannot set status='approved' directly and skip the ownership and
  // subscription checks (or the case.submitted webhook below).
  const { data: submitResult, error: updateError } = await supabase.rpc('submit_case', {
    p_entry_id: entryId,
  });

  if (updateError) {
    const message = updateError.message ?? 'Could not submit the case.';
    const status = /not a draft|not found/i.test(message)
      ? 409
      : /lapsed/i.test(message)
        ? 403
        : 500;
    return { status, body: { error: message } };
  }

  const result = (submitResult ?? {}) as { status?: string; auto_approved?: boolean };

  if (tenant?.tenant_type === 'individual' || result.auto_approved) {
    return { status: 200, body: { success: true, auto_approved: true } };
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
        entry_id: entryId,
        supervisor_id: s.id,
        status: 'pending',
      })),
    );

    if (approvalError) {
      // The approvals queue reads status='pending' from case_entries, so the
      // case is still reviewable. Do not try to revert: pending -> draft is
      // not a legal transition and the old revert always failed.
      console.error('[cases/submit] approval_requests insert failed:', approvalError.message);
    }
  }

  // Fire webhook event after successful case submission
  dispatchWebhookEvent({
    tenant_id: entry.tenant_id,
    event_type: 'case.submitted',
    event_id: entryId,
    data: { entry_id: entryId, resident_id: entry.resident_id },
  }).catch((err) => {
    console.error('[webhooks] Submit dispatch error:', err);
  });

  // Push notification to supervisors (fire-and-forget; failures are logged).
  if (supervisors && supervisors.length > 0) {
    for (const s of supervisors) {
      notifyPendingApproval(entryId, s.id, profile.full_name || 'A resident').catch((err) =>
        console.error('[push] pending-approval push failed:', err),
      );
    }
  }

  return { status: 200, body: { success: true } };
}
