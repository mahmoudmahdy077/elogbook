import { createServiceRoleClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * Push notifications via the Expo push API.
 *
 * PHI EGRESS: Expo is an external vendor. A push notification lands on a
 * lock screen that anyone with the device can read, so the payload is
 * default-deny:
 *   1. No approved vendor policy in configuration -> nothing is sent.
 *   2. Only pre-approved generic copy is sent. A caller cannot pass free text.
 *   3. The `data` payload is restricted to opaque identifiers, counts and
 *      fixed enums; a resident name, reviewer name or case detail is dropped.
 */

interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export const PUSH_VENDOR_PAYLOAD_POLICY = 'metadata_only';

/** The only copy that may leave the tenant boundary. */
export const APPROVED_PUSH_COPY = {
  caseApproved: { title: 'Case approved', body: 'A case decision is ready in the app.' },
  caseRejected: { title: 'Case decision', body: 'A case decision is ready in the app.' },
  pendingApproval: { title: 'Review requested', body: 'A case is waiting for review in the app.' },
} as const;

const APPROVED_COPY = new Set<string>(
  Object.values(APPROVED_PUSH_COPY).flatMap((entry) => [entry.title, entry.body]),
);

const ALLOWED_DATA_KEYS = ['type', 'caseId', 'entryId', 'status', 'tenantId', 'count'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENUM_RE = /^[a-z][a-z0-9_.]{0,63}$/;
const ID_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function isPushVendorPolicyApproved(policy: string | undefined = process.env.PUSH_VENDOR_POLICY): boolean {
  return policy === PUSH_VENDOR_PAYLOAD_POLICY;
}

function isOpaqueDataValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  if (UUID_RE.test(value) || ENUM_RE.test(value)) return true;
  // An internal row reference (`entry-1`, `req_42`): a single token, no spaces,
  // and carrying a digit. Prose — a name, a note, a case detail — never matches.
  return ID_TOKEN_RE.test(value) && /\d/.test(value);
}

/**
 * Drop keys that are not part of the opaque contract, and refuse the whole
 * message when an allowlisted key holds something that is not an opaque value.
 * Silently stripping a prose value would let a caller believe the detail was
 * transmitted; failing closed surfaces the bug instead.
 */
function sanitizePushData(data: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!data) return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!(ALLOWED_DATA_KEYS as readonly string[]).includes(key)) continue;
    if (!isOpaqueDataValue(value)) return null;
    sanitized[key] = value;
  }
  return sanitized;
}

/**
 * Send a push notification to a user via Expo Push API.
 * Looks up the user's Expo push tokens from the push_tokens table.
 */
export async function sendPushNotification(
  userId: string,
  { title, body, data }: NotificationPayload,
): Promise<void> {
  // Default deny: no approved vendor policy means nothing leaves the system.
  if (!isPushVendorPolicyApproved()) {
    logger.warn('Push vendor policy not approved; notification withheld', {
      reason: 'push_vendor_policy_required',
    });
    return;
  }

  if (!APPROVED_COPY.has(title) || !APPROVED_COPY.has(body)) {
    logger.warn('Push copy is not in the approved set; notification withheld', {
      reason: 'push_copy_not_approved',
    });
    return;
  }

  const sanitizedData = sanitizePushData(data);
  if (sanitizedData === null) {
    logger.warn('Push data payload is not opaque; notification withheld', {
      reason: 'push_data_not_opaque',
    });
    return;
  }

  const supabase = createServiceRoleClient();

  // Callers pass a profiles.id; push_tokens.user_id stores the auth user id
  // (profiles.id and auth.users.id are distinct — see 00001_schema.sql).
  // Resolve profile -> auth user before matching tokens.
  const { data: prof } = await supabase
    .from('profiles') // tenant-scope-exempt: user-scoped lookup by user_id (1:1), not tenant list — owner=human expiry=2026-12-31
    .select('user_id')
    .eq('id', userId)
    .maybeSingle();
  if (!prof?.user_id) return;

  // Get user's push tokens
  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', prof.user_id)
    .eq('active', true);

  if (error || !tokens?.length) {
    // No push tokens — notification is a no-op
    return;
  }

  const messages = tokens
    .filter((t: { token?: string }) => t.token?.startsWith('ExponentPushToken'))
    .map((t: { token?: string }) => ({
      to: t.token,
      sound: 'default' as const,
      title,
      body,
      data: sanitizedData,
      priority: 'high' as const,
    }));

  if (!messages.length) return;

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    const result = await response.json();

    // Handle invalid/expired tokens
    if (result.data) {
      const toRemove: string[] = [];
      for (const receipt of result.data) {
        if (receipt?.status === 'error' && receipt?.details?.error === 'DeviceNotRegistered') {
          toRemove.push(receipt.to);
        }
      }
      if (toRemove.length) {
        await supabase
          .from('push_tokens')
          .update({ active: false })
          .in('token', toRemove);
      }
    }
  } catch (err) {
    // Log but don't throw — notification failures shouldn't block the app
    logger.error('Push notification send failed', err, { userId });
  }
}

/**
 * Send an approval decision notification to the case owner. The decision is
 * conveyed by the title; the body deliberately says nothing about the case, and
 * no reviewer name is included.
 */
export async function notifyCaseApproval(
  caseEntryId: string,
  residentId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  const copy = status === 'approved' ? APPROVED_PUSH_COPY.caseApproved : APPROVED_PUSH_COPY.caseRejected;
  await sendPushNotification(residentId, {
    title: copy.title,
    body: copy.body,
    data: { type: `case.${status}`, caseId: caseEntryId, status },
  });
}

/**
 * Notify a reviewer that a case is waiting. The resident's name is never
 * included.
 */
export async function notifyPendingApproval(
  caseEntryId: string,
  supervisorId: string,
): Promise<void> {
  await sendPushNotification(supervisorId, {
    title: APPROVED_PUSH_COPY.pendingApproval.title,
    body: APPROVED_PUSH_COPY.pendingApproval.body,
    data: { type: 'approval.pending', caseId: caseEntryId },
  });
}
