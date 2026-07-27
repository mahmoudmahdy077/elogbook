/**
 * Navigation route types for Expo Router deep linking.
 *
 * Replaces ad-hoc `as any` casts throughout the notification and linking modules.
 */

// All valid static routes in the app
export type AppRoute =
  | '/(tabs)'
  | '/(tabs)/index'
  | '/(tabs)/my-cases'
  | '/(tabs)/log-case'
  | '/(tabs)/approvals'
  | '/(tabs)/case-detail'
  | '/(tabs)/rotations'
  | '/(tabs)/evaluations'
  | '/(tabs)/milestones'
  | '/(tabs)/duty-hours'
  | '/(tabs)/profile'
  | '/(tabs)/ai-insights'
  | '/login';

/** A typed deep-link route with optional params */
export interface TypedRoute {
  pathname: AppRoute;
  params?: Record<string, string>;
}

/** Type-safe helper to create a route */
export function route(pathname: AppRoute, params?: Record<string, string>): TypedRoute {
  return { pathname, params };
}

/** All valid tab routes for navigation */
export const Routes = {
  HOME: '/(tabs)/index' as const,
  MY_CASES: '/(tabs)/my-cases' as const,
  LOG_CASE: '/(tabs)/log-case' as const,
  APPROVALS: '/(tabs)/approvals' as const,
  CASE_DETAIL: '/(tabs)/case-detail' as const,
  ROTATIONS: '/(tabs)/rotations' as const,
  EVALUATIONS: '/(tabs)/evaluations' as const,
  MILESTONES: '/(tabs)/milestones' as const,
  DUTY_HOURS: '/(tabs)/duty-hours' as const,
  PROFILE: '/(tabs)/profile' as const,
  AI_INSIGHTS: '/(tabs)/ai-insights' as const,
  LOGIN: '/login' as const,
} as const;
