import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { validateEmailQueuePayload } from '@elogbook/shared/email/safety';
import {
  buildInvitationAcceptUrl,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
} from '@/lib/invitations/token';
import { z } from 'zod';
import { logger } from '@/lib/logger';

/**
 * Tenant admin invitation issuance.
 *
 * Boundary this route owns
 * ------------------------
 * It mints an invitation, and only an invitation. It deliberately does NOT
 * create the auth identity: doing so would let the identity be enrolled from
 * Supabase's own email with no reference to the invitation token, which would
 * make the token gate on POST /api/invitations/accept meaningless.
 *
 * Token handling: the raw token exists for exactly two moments -- inside this
 * handler, to build the accept link, and inside the queued email. What reaches
 * PostgreSQL is sha256(raw). The response body is `{ success: true }`.
 */
const inviteSchema = z.object({
  email: z.string().email().max(320),
  // Optional: a bulk import has no name for the invitee. When present it is
  // only the greeting in the queued email (email_queue.to_name).
  full_name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['resident', 'supervisor', 'director']),
  specialty: z.string().trim().max(120).optional(),
}).strict();

const DEFAULT_APP_ORIGIN = 'http://localhost:3000';

function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return DEFAULT_APP_ORIGIN;
  try {
    const url = new URL(configured);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
  return DEFAULT_APP_ORIGIN;
}

async function deleteInvitation(
  adminClient: ReturnType<typeof createServiceRoleClient>,
  inviteId: string,
): Promise<unknown> {
  try {
    const result = await adminClient.from('tenant_invites').delete().eq('id', inviteId);
    return result.error;
  } catch (error) {
    return error;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const guarded = await guardRequest(request, inviteSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 8 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`invite:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  const { email, full_name: fullName, role: inviteRole, specialty } = guarded.data;  const normalizedEmail = email.trim().toLowerCase();

  const adminClient = createServiceRoleClient();
  const token = generateInvitationToken();
  const expiresAt = invitationExpiresAt(new Date());

  // Tenant comes from the admin's own profile, never from the request body.
  const { data: invite, error: inviteError } = await adminClient
    .from('tenant_invites')
    .insert({
      tenant_id: profile.tenant_id,
      email: normalizedEmail,
      invited_by: user.id,
      role: inviteRole,
      status: 'pending',
      token_hash: hashInvitationToken(token),
      expires_at: expiresAt.toISOString(),
      specialty: specialty ?? null,
    })
    .select('id')
    .single();
  if (inviteError || !invite) {
    logger.error('Failed to create user invitation', inviteError, { tenantSlug });
    return NextResponse.json({ error: 'Failed to create user invitation' }, { status: 500 });
  }

  // The queued payload is metadata plus one link. validateEmailQueuePayload is
  // the same gate the queue processor applies, so a payload that would be
  // rejected at send time is rejected at enqueue time instead.
  const onboardingUrl = buildInvitationAcceptUrl(appOrigin(), token);
  const payload: Record<string, string> = {
    role: inviteRole,
    onboarding_url: onboardingUrl,
  };
  const payloadCheck = validateEmailQueuePayload(payload);
  if (!payloadCheck.ok) {
    const cleanup = await deleteInvitation(adminClient, invite.id);
    logger.error('Invitation email payload rejected', cleanup ?? new Error(payloadCheck.code), {
      tenantSlug,
    });
    return NextResponse.json({ error: 'Failed to create user invitation' }, { status: 500 });
  }

  let queueError: unknown = null;
  try {
    const queued = await adminClient.from('email_queue').insert({
      template_key: 'invite.welcome',
      to_email: normalizedEmail,
      to_name: fullName,
      tenant_id: profile.tenant_id,
      payload,
      priority: 5,
    });
    queueError = queued.error;
  } catch (error) {
    queueError = error;
  }
  if (queueError) {
    // An invitation nobody can reach is a dead record, not a pending one.
    const cleanup = await deleteInvitation(adminClient, invite.id);
    if (cleanup) {
      logger.error('Failed to queue the invitation email and to remove the unreachable invitation', queueError, {
        tenantSlug,
        cleanupError: String(cleanup),
      });
    } else {
      logger.error('Failed to queue the invitation email', queueError, { tenantSlug });
    }
    return NextResponse.json(
      { error: 'The invitation could not be emailed. Please try again.' },
      { status: 502 },
    );
  }

  let auditError: unknown = null;
  try {
    const auditResult = await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'invite_user',
      resource_type: 'tenant_invites',
      resource_id: invite.id,
      changes: { changed_fields: ['invite'] },
    });
    auditError = auditResult.error;
  } catch (error) {
    auditError = error;
  }
  if (auditError) {
    const cleanup = await deleteInvitation(adminClient, invite.id);
    if (cleanup) {
      logger.error('Failed to audit the invited user and to remove the unaudited invitation', auditError, {
        tenantSlug,
        cleanupError: String(cleanup),
      });
    } else {
      logger.error('Failed to audit invited user', auditError, { tenantSlug });
    }
    return NextResponse.json({ error: 'Failed to create user invitation' }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
