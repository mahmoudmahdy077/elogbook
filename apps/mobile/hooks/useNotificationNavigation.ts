/**
 * useNotificationNavigation
 *
 * React hook that handles navigation triggered by push notifications.
 *
 * Integrates with the existing notification-handler.ts and linking.ts
 * infrastructure to provide a clean React-compatible API.
 *
 * Supported notification payloads:
 *   { type: 'case.approved',  caseId: 'uuid' }  → case-detail screen
 *   { type: 'case.rejected',  caseId: 'uuid' }  → case-detail screen
 *   { type: 'case.commented', caseId: 'uuid' }  → case-detail screen
 *   { type: 'new.rejection',  caseId: 'uuid' }  → case-detail screen
 *   { type: 'approval.pending'                  → approvals tab
 *   { type: 'approval.requested' }              → approvals tab
 *   { type: 'deep.link',       url: '...' }     → parsed deep link
 *
 * Usage:
 *   // In root layout — replaces raw registerNotificationHandler() calls
 *   useNotificationNavigation();
 *
 *   // In a specific screen — provides visibility into what was navigated
 *   const { lastNavigatedRoute } = useNotificationNavigation();
 *
 * NOTE: The root _layout.tsx already wires up notification handling via
 * registerNotificationHandler() + handleColdStartNotification(). This hook
 * provides an alternative declarative API and can coexist or replace that.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { parseDeepLink } from '../lib/linking';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationPayload {
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

export interface LastNavigatedRoute {
  /** The screen pathname that was navigated to, or null */
  pathname: string | null;
  /** The timestamp when navigation occurred */
  timestamp: number;
  /** The raw notification payload that triggered the navigation */
  payload: NotificationPayload;
}

// ---------------------------------------------------------------------------
// Core mapping: notification type → screen navigation
// ---------------------------------------------------------------------------

function notificationToRoute(
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
          pathname: '/(tabs)/case-detail' as any,
          params: { caseId: payload.caseId },
        };
      }
      return { pathname: '/(tabs)/my-cases' as any };

    case 'approval.pending':
    case 'approval.requested':
      return { pathname: '/(tabs)/approvals' as any };

    case 'deep.link':
      if (payload.url) {
        const route = parseDeepLink(payload.url);
        if (route) {
          return route.params
            ? { pathname: route.screen as any, params: route.params }
            : { pathname: route.screen as any };
        }
      }
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseNotificationNavigationOptions {
  /**
   * If true, also checks for and handles cold-start notifications
   * (app launched by tapping a notification). Default: true.
   */
  handleColdStart?: boolean;

  /**
   * Delay in ms before navigating after receiving a notification.
   * Helps ensure the navigation container is fully mounted. Default: 100.
   */
  navigationDelay?: number;

  /**
   * Optional callback fired after any notification-driven navigation.
   */
  onNavigate?: (route: { pathname: string; params?: Record<string, string> }) => void;
}

export function useNotificationNavigation(
  options: UseNotificationNavigationOptions = {}
) {
  const {
    handleColdStart = true,
    navigationDelay = 100,
    onNavigate,
  } = options;

  const [lastNavigatedRoute, setLastNavigatedRoute] =
    useState<LastNavigatedRoute | null>(null);

  // Ref to prevent double navigation in StrictMode
  const handledColdStart = useRef(false);

  // -----------------------------------------------------------------------
  // Navigate based on a notification payload
  // -----------------------------------------------------------------------

  const navigateFromNotification = useCallback(
    (payload: NotificationPayload) => {
      const route = notificationToRoute(payload);
      if (!route) return;

      // Use a small delay to ensure the navigation container is mounted.
      setTimeout(() => {
        if (route.params) {
          router.navigate({
            pathname: route.pathname,
            params: route.params,
          });
        } else {
          router.navigate(route.pathname);
        }

        setLastNavigatedRoute({
          pathname: route.pathname,
          timestamp: Date.now(),
          payload,
        });

        onNavigate?.(route);
      }, navigationDelay);
    },
    [navigationDelay, onNavigate]
  );

  // -----------------------------------------------------------------------
  // Subscribe to notification responses (user taps notification banner)
  // -----------------------------------------------------------------------

  useEffect(() => {
    const subscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const payload = response.notification.request.content
          .data as NotificationPayload | null;
        if (!payload) return;
        navigateFromNotification(payload);
      });

    return () => subscription.remove();
  }, [navigateFromNotification]);

  // -----------------------------------------------------------------------
  // Handle cold-start notification (app launched by tapping a notification)
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!handleColdStart || handledColdStart.current) return;

    handledColdStart.current = true;

    Notifications.getLastNotificationResponseAsync().then((lastResponse) => {
      if (lastResponse) {
        const payload = lastResponse.notification.request.content
          .data as NotificationPayload | null;
        if (!payload) return;
        navigateFromNotification(payload);
      }
    });
  }, [handleColdStart, navigateFromNotification]);

  // -----------------------------------------------------------------------
  // Expose the last navigated route for downstream consumers
  // -----------------------------------------------------------------------

  return { lastNavigatedRoute };
}
