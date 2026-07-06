/**
 * Deep linking configuration for E-Logbook.
 *
 * Maps custom URL patterns to Expo Router screen paths.
 *
 * elogbook://case/{id}  →  (tabs)/case-detail?caseId={id}
 * elogbook://approvals  →  (tabs)/approvals
 * elogbook://dashboard  →  (tabs)/index              (home / dashboard)
 * elogbook://profile    →  (tabs)/profile
 * elogbook://log-case   →  (tabs)/log-case
 * elogbook://my-cases   →  (tabs)/my-cases
 * elogbook://ai-insights → (tabs)/ai-insights
 * elogbook://duty-hours  →  (tabs)/duty-hours
 *
 * Supports both:
 *   - Custom scheme URLs:   elogbook://case/abc-123
 *   - Universal links:      https://elogbook.app/case/abc-123
 *
 * Pairs with notification-handler.ts for push notification navigation.
 */

import { router } from 'expo-router';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Route definitions — single source of truth for all deep-link → screen
// mappings.  The key is the "logical" route name exposed to the outside world;
// the value is the Expo Router file‑system path (with optional :param tokens).
// ---------------------------------------------------------------------------

export interface DeepLinkRoute {
  /** Expo Router path, e.g. "/(tabs)/case-detail" */
  screen: string;
  /** Query / params to merge when navigating via deep link */
  params?: Record<string, string>;
}

const ROUTE_MAP: Record<string, (match: RegExpExecArray) => DeepLinkRoute> = {
  // elogbook://case/<caseId>
  case: (m) => ({
    screen: '/(tabs)/case-detail',
    params: { caseId: m[1] },
  }),
  // elogbook://approvals
  approvals: () => ({ screen: '/(tabs)/approvals' }),
  // elogbook://dashboard
  dashboard: () => ({ screen: '/(tabs)' }), // index inside (tabs)
  // elogbook://profile
  profile: () => ({ screen: '/(tabs)/profile' }),
  // elogbook://log-case
  'log-case': () => ({ screen: '/(tabs)/log-case' }),
  // elogbook://my-cases
  'my-cases': () => ({ screen: '/(tabs)/my-cases' }),
  // elogbook://ai-insights
  'ai-insights': () => ({ screen: '/(tabs)/ai-insights' }),
  // elogbook://duty-hours
  'duty-hours': () => ({ screen: '/(tabs)/duty-hours' }),
};

// Matches patterns like:
//   elogbook://case/abc-123
//   elogbook://approvals
//   https://elogbook.app/case/abc-123
//   https://elogbook.app/approvals
const LINK_PATTERN =
  /^(?:elogbook:\/\/|https:\/\/elogbook\.app\/)([a-z-]+)(?:\/([^?#]+))?/i;

// ---------------------------------------------------------------------------
// Parse an incoming URL and return the matching route + params (or null).
// ---------------------------------------------------------------------------

export function parseDeepLink(url: string): DeepLinkRoute | null {
  const match = LINK_PATTERN.exec(url);
  if (!match) return null;

  const routeName = match[1]; // e.g. "case", "approvals"
  const builder = ROUTE_MAP[routeName];
  if (!builder) return null;

  return builder(match);
}

// ---------------------------------------------------------------------------
// React Navigation linking config — consumed by Expo Router behind the scenes
// when `app.json` has a `scheme` set.  This ensures Expo Router's automatic
// linking works for our custom URL shapes.
//
// NOTE: Expo Router reads `scheme` from app.json automatically.  The config
// below is exported so layouts can explicitly subscribe to notifications and
// cold‑start deep links.
// ---------------------------------------------------------------------------

export const linkingConfig = {
  prefixes: ['elogbook://', 'https://elogbook.app'],
  config: {
    screens: {
      login: 'login',
      '(tabs)': {
        screens: {
          index: {
            path: 'dashboard',
          },
          'case-detail': {
            path: 'case/:caseId',
            parse: {
              caseId: (id: string) => id,
            },
          },
          approvals: 'approvals',
          profile: 'profile',
          'log-case': 'log-case',
          'my-cases': 'my-cases',
          'ai-insights': 'ai-insights',
          'duty-hours': 'duty-hours',
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Navigate to a parsed deep-link route (safe to call from notification
// handlers, background listeners, etc.).
// ---------------------------------------------------------------------------

export function navigateToDeepLink(route: DeepLinkRoute): void {
  if (route.params) {
    router.navigate({
      pathname: route.screen as any,
      params: route.params,
    });
  } else {
    router.navigate(route.screen as any);
  }
}
