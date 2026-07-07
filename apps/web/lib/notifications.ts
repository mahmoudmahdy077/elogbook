import { createServerSupabase } from '@/lib/supabase/server';

interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Send a push notification to a user via Expo Push API.
 * Looks up the user's Expo push tokens from the push_tokens table.
 */
export async function sendPushNotification(
  userId: string,
  { title, body, data }: NotificationPayload,
): Promise<void> {
  const supabase = await createServerSupabase();

  // Get user's push tokens
  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
    .eq('active', true);

  if (error || !tokens?.length) {
    // No push tokens — notification is a no-op
    return;
  }

  const messages = tokens
    .filter((t) => t.token?.startsWith('ExponentPushToken'))
    .map((t) => ({
      to: t.token,
      sound: 'default' as const,
      title,
      body,
      data: data ?? {},
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
    console.error('Push notification send failed:', err);
  }
}

/**
 * Send an approval notification to the case owner.
 */
export async function notifyCaseApproval(
  caseEntryId: string,
  residentId: string,
  status: 'approved' | 'rejected',
  reviewerName: string,
): Promise<void> {
  const action = status === 'approved' ? 'approved' : 'rejected';
  await sendPushNotification(residentId, {
    title: `Case ${action}`,
    body: `Your case has been ${action} by ${reviewerName}.`,
    data: { type: `case.${action}`, caseId: caseEntryId },
  });
}

/**
 * Send a pending approval notification to a supervisor.
 */
export async function notifyPendingApproval(
  caseEntryId: string,
  supervisorId: string,
  residentName: string,
): Promise<void> {
  await sendPushNotification(supervisorId, {
    title: 'New case pending approval',
    body: `${residentName} submitted a case for your review.`,
    data: { type: 'approval.pending', caseId: caseEntryId },
  });
}
