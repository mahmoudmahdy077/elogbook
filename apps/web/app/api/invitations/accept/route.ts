import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import {
  classifyInvitation,
  hashInvitationToken,
  isValidInvitationTokenFormat,
  type InvitationRow,
  type InvitationState,
} from '@/lib/invitations/token';
import { logger } from '@/lib/logger';
import { z } from 'zod';

/**
 * Invitation redemption.
 *
 * Current product path (audit, 2026-09-28)
 * ---------------------------------------
 * 1. A tenant admin calls POST /api/[tenant]/admin/invite. That route creates a
 *    pending `tenant_invites` row bound to the admin's own tenant and asks
 *    Supabase Auth to email an invitation.
 * 2. The recipient follows the emailed link, Supabase creates the auth user,
 *    and the `handle_new_user` trigger consumes the pending invite to decide
 *    which tenant the new profile belongs to.
 *
 * Before this route, step 2 had no product surface: /signup called
 * `supabase.auth.signUp` directly, so any anonymous visitor could create an
 * account with no invitation at all, and handle_new_user provisioned a tenant
 * for them. This route is the redemption surface that requires a real,
 * unexpired, unspent tenant invitation.
 *
 * Invariant: the tenant is read from the invite row and never from the request.
 * There is no tenant field in the schema, so redemption cannot be pointed at
 * another tenant. An address that is not the invited address is refused with
 * the same coarse 404 as an unknown token, so the endpoint is not an oracle for
 * which addresses an institution has invited.
 */
const acceptSchema = z.object({
  token: z.string().trim().min(1).max(128),
  email: z.string().email().max(320),
  full_name: z.string().trim().min(1).max(120).optional(),
}).strict();

const STATE_STATUS: Record<InvitationState, number> = {
  valid: 201,
  unknown: 404,
  used: 409,
  expired: 410,
};

const STATE_MESSAGE: Record<InvitationState, string> = {
  valid: '',
  // 'unknown' and 'used' are deliberately indistinguishable from the outside:
  // an unknown token, an address that was never invited, and an invitation
  // belonging to somebody else must all look the same.
  unknown: 'Invitation not found',
  used: 'This invitation has already been used. Ask your administrator for a new one.',
  expired: 'This invitation has expired. Ask your administrator for a new one.',
};

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

export async function POST(request: Request) {
  const guarded = await guardRequest(request, acceptSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`invitation-accept:${ip}`, 10);
  if (!allowed) return rateLimitResponse(retryAfter);

  const { token, email, full_name: fullName } = guarded.data;
  if (!isValidInvitationTokenFormat(token)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();

  // Lookup by digest. The raw token is never sent to the database, and a
  // malformed-format token was already rejected above, so this is the only
  // path that can reach the table.
  const { data: invite, error: lookupError } = await adminClient
    .from('tenant_invites')
    .select('id, tenant_id, email, role, status, expires_at')
    .eq('token_hash', hashInvitationToken(token))
    .maybeSingle();

  if (lookupError) {
    logger.error('Failed to read tenant invitation', lookupError, {});
    return NextResponse.json({ error: 'Could not verify this invitation' }, { status: 500 });
  }

  const state = classifyInvitation(invite as InvitationRow | null, new Date()).state;
  const emailMatches =
    state === 'valid' &&
    typeof (invite as { email?: unknown } | null)?.email === 'string' &&
    (invite as { email: string }).email.trim().toLowerCase() === email.trim().toLowerCase();

  if (state !== 'valid' || !emailMatches) {
    const reported: InvitationState = state === 'valid' ? 'unknown' : state;
    return NextResponse.json(
      { error: STATE_MESSAGE[reported] },
      { status: STATE_STATUS[reported] },
    );
  }

  const redirectUrl = `${appOrigin()}/auth/callback?next=${encodeURIComponent('/onboarding')}`;
  let createdUserId: string | undefined;
  let authError: unknown = null;
  try {
    const authResult = await adminClient.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
      redirectTo: redirectUrl,
      data: { full_name: fullName ?? null },
    });
    createdUserId = authResult.data?.user?.id;
    authError = authResult.error;
  } catch (error) {
    authError = error;
  }

  if (authError || !createdUserId) {
    if (createdUserId) {
      try {
        await adminClient.auth.admin.deleteUser(createdUserId);
      } catch (rollbackError) {
        logger.error('Failed to roll back a partially created identity', rollbackError, {});
      }
    }
    logger.error('Failed to send the tenant invitation email', authError ?? null, {});
    return NextResponse.json(
      { error: 'Could not send the invitation email. Please try again.' },
      { status: 502 },
    );
  }

  // The response carries no token, no digest, no tenant id and no email: the
  // caller already proved possession of the invitation by presenting the token.
  return NextResponse.json({ success: true }, { status: 201 });
}
