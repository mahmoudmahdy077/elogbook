import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import { dispatchWebhookEvent } from '@/lib/webhooks';

const ALLOWED_ROLES = ['supervisor', 'director', 'institution_admin', 'admin'];

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
  // ---- CSRF check ----
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  // ---- Rate limit by IP (20 req/min) ----
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const { allowed, retryAfter } = checkRateLimit(`approve-action:${ip}`, 20);
  if (!allowed) return rateLimitResponse(retryAfter);

  // ---- Auth ----
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---- Get caller's profile + tenant ----
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 403 });
  }

  const tenant = profile.tenants as { slug: string };
  const { tenant: tenantSlug } = await params;

  // ---- P1.6: Tenant-slug URL validation ----
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  // ---- Role check ----
  if (!ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json(
      { error: 'Only supervisors and directors can perform approval actions' },
      { status: 403 },
    );
  }

  // ---- Parse body ----
  let body: { action?: string; entry_id?: string; comment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, entry_id, comment } = body;

  if (!action || !entry_id) {
    return NextResponse.json(
      { error: 'action and entry_id are required' },
      { status: 400 },
    );
  }

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: 'action must be "approve" or "reject"' },
      { status: 400 },
    );
  }

  // ---- Ensure the entry belongs to the same tenant ----
  const { data: entry } = await supabase
    .from('case_entries')
    .select('id, tenant_id, status')
    .eq('id', entry_id)
    .single();

  if (!entry) {
    return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  }

  if (entry.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Entry does not belong to your tenant' }, { status: 403 });
  }

  // ---- Call the Supabase RPC ----
  const rpcName = action === 'approve' ? 'approve_case' : 'reject_case';
  const { error: rpcError } = await supabase.rpc(rpcName, {
    p_entry_id: entry_id,
    p_supervisor_id: user.id,
    p_comment: comment || null,
  });

  if (rpcError) {
    return NextResponse.json(
      { error: rpcError.message || 'Failed to process approval action' },
      { status: 500 },
    );
  }

  // Fire webhook event after successful approval/rejection
  dispatchWebhookEvent({
    tenant_id: profile.tenant_id,
    event_type: action === 'approve' ? 'case.approved' : 'case.rejected',
    event_id: entry_id,
    data: { entry_id, comment: comment || null, acted_by: user.id },
  }).catch((err) => {
    console.error('[webhooks] Approval dispatch error:', err);
  });

  return NextResponse.json({ success: true, action });
}
