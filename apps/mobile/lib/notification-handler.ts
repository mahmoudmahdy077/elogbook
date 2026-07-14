/**
 * Notification navigation handler.
 *
 * Maps incoming notification payloads to deep-linked screen routes.
 * Designed to work alongside the linking.ts module and the polling-based
 * notification polling in notifications.ts (P5.17 — push notifications
 * are deferred to a later phase).
 *
 * Notification data format:
 *   { type: 'case.approved',  caseId: 'uuid' }
 *   { type: 'case.rejected',  caseId: 'uuid' }
 *   { type: 'case.commented', caseId: 'uuid' }
 *   { type: 'approval.requested' }
 *   { type: 'new.rejection',  caseId: 'uuid' }
 *
 * When a user taps a notification, handleNotificationResponse parses the
 * payload and navigates to the correct screen.
 */

import * as Notifications from 'expo-notifications';
import { parseDeepLink } from './linking';

// ---------------------------------------------------------------------------
// Notification payload types understood by this handler.
// ---------------------------------------------------------------------------

interface NotificationPayload {
  type?:
    | 'case.approved'
    | 'case.rejected'
    | 'case.commented'
    | 'approval.requested'
    | 'approval.pending'
    | 'new.rejection'
    | 'deep.link';
  caseId?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Map a notification payload to a deep-link route.
// ---------------------------------------------------------------------------

function payloadToDeepLink(
  payload: NotificationPayload
): { pathname: string; params?: Record<string, string> } | null {
  if (!payload.type) return null;

  switch (payload.type) {
    case 'case.approved':
    case 'case.rejected':
    case 'case.commented':
    case 'new.rejection':
      if (payload.caseId) {
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pathname: '/(tabs)/case-detail' as any,
          params: { caseId: payload.caseId },
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { pathname: '/(tabs)/my-cases' as any };

    case 'approval.pending':
    case 'approval.requested':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { pathname: '/(tabs)/approvals' as any };

    case 'deep.link':
      if (payload.url) {
        const route = parseDeepLink(payload.url);
        if (route) {
          return route.params
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { pathname: route.screen as any, params: route.params }
            : // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { pathname: route.screen as any };
        }
      }
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Handle a notification response (user tapped on a notification).
// Called from the root layout's subscription.
// ---------------------------------------------------------------------------

export function handleNotificationResponse(
  response: Notifications.NotificationResponse
): void {
  const payload = response.notification.request.content
    .data as NotificationPayload | null;
  if (!payload) return;

  const route = payloadToDeepLink(payload);
  if (!route) return;

  // Use a small delay to ensure the navigation container is mounted.
  // Expo Router needs to be ready before router.navigate() works.
  setTimeout(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router');
    if (route.params) {
      router.navigate({
        pathname: route.pathname,
        params: route.params,
      });
    } else {
      router.navigate(route.pathname);
    }
  }, 100);
}

// ---------------------------------------------------------------------------
// Register the expo-notifications listener.
// Returns an unsubscribe function for cleanup.
// ---------------------------------------------------------------------------

export function registerNotificationHandler(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    handleNotificationResponse
  );
  return () => subscription.remove();
}

// ---------------------------------------------------------------------------
// Handle cold-start notification (app launched by tapping a notification).
// Should be called once from the root layout on mount.
// ---------------------------------------------------------------------------

export async function handleColdStartNotification(): Promise<void> {
  const lastResponse =
    await Notifications.getLastNotificationResponseAsync();
  if (lastResponse) {
    handleNotificationResponse(lastResponse);
  }
}
