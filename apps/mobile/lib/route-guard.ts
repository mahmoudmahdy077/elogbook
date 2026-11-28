/**
 * N1 — centralized route guards (single map for tabs, menu, deep links).
 *
 * Screens, the side menu, and every deep-link/notification entry consult
 * this module. Menu affordances may use display-role hints, but navigation
 * to a guarded route requires a capable session here AND server enforcement
 * at the data layer. Admin consoles have no mobile route: deep links to
 * them are refused outright.
 */

import { canPerform, type SensitiveAction } from './authorization';
import { isCapabilityFresh } from './capability';
import type { CapabilitySnapshot } from './capability';
import type { MobileFeatureKey } from '@elogbook/shared';

export type RouteName =
  | 'index' | 'log-case' | 'my-cases' | 'case-detail' | 'approvals'
  | 'evaluations' | 'duty-hours' | 'rotations' | 'milestones'
  | 'analytics' | 'ai-insights' | 'profile';

export interface RouteGuard {
  /** Sensitive action checked against the capability, or 'read' for plain view. */
  action: SensitiveAction | 'read';
}

export const ROUTE_GUARDS: Record<RouteName, RouteGuard> = {
  index: { action: 'read' },
  'log-case': { action: 'case:create' },
  'my-cases': { action: 'read' },
  'case-detail': { action: 'read' },
  approvals: { action: 'case:approve' },
  evaluations: { action: 'evaluation:create' },
  'duty-hours': { action: 'duty:create' },
  rotations: { action: 'read' },
  milestones: { action: 'read' },
  analytics: { action: 'read' },
  'ai-insights': { action: 'ai:insights' },
  profile: { action: 'read' },
};

/** Deep-link host → mobile route (must stay in sync with linking.ts). */
const DEEP_LINK_ROUTES: Record<string, RouteName> = {
  dashboard: 'index',
  'log-case': 'log-case',
  'my-cases': 'my-cases',
  case: 'case-detail',
  approvals: 'approvals',
  profile: 'profile',
  'ai-insights': 'ai-insights',
  'duty-hours': 'duty-hours',
};

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/** Route → web-controlled module. Routes absent here are always available. */
export const ROUTE_MODULES: Partial<Record<RouteName, MobileFeatureKey>> = {
  'log-case': 'log_case',
  'my-cases': 'my_cases',
  'case-detail': 'my_cases',
  approvals: 'approvals',
  evaluations: 'evaluations',
  'duty-hours': 'duty_hours',
  rotations: 'rotations',
  milestones: 'milestones',
  analytics: 'analytics',
  'ai-insights': 'ai_insights',
};

// The remote config is loaded asynchronously, so guards read the current
// resolver instead of threading config through every caller. When unset
// (tests, pre-boot) every module is treated as enabled.
let featureResolver: ((key: MobileFeatureKey) => boolean) | null = null;

export function setRouteFeatureResolver(
  resolver: ((key: MobileFeatureKey) => boolean) | null,
): void {
  featureResolver = resolver;
}

function moduleAllowed(route: RouteName): boolean {
  const key = ROUTE_MODULES[route];
  if (!key || !featureResolver) return true;
  return featureResolver(key);
}

export function guardRoute(route: RouteName, cap: CapabilitySnapshot | null): GuardResult {
  if (!cap) return { ok: false, reason: 'no session capability' };
  if (cap.status !== 'active') return { ok: false, reason: `account ${cap.status}` };
  if (!moduleAllowed(route)) return { ok: false, reason: 'module disabled by your organisation' };
  const guard = ROUTE_GUARDS[route];
  if (guard.action === 'read') return { ok: true };
  return canPerform(cap, guard.action);
}

export interface DeepLinkVerdict {
  allowed: boolean;
  route?: RouteName;
  reason?: string;
}

/** Expo Router pathname (e.g. '/(tabs)/approvals') → guarded route. */
export function routeForPathname(pathname: string): RouteName | null {
  const m = /^\(tabs\)\/([a-z-]+)/i.exec(pathname.replace(/^\//, ''));
  if (!m) {
    if (/^\(tabs\)$/i.test(pathname.replace(/^\//, ''))) return 'index';
    return null;
  }
  const name = m[1].toLowerCase() as RouteName;
  return name in ROUTE_GUARDS ? name : null;
}

/** Authorize an already-parsed navigation target (notifications, menus). */
export function guardPathname(pathname: string, cap: CapabilitySnapshot | null): GuardResult & { route?: RouteName } {
  const route = routeForPathname(pathname);
  if (!route) return { ok: false, reason: 'unsupported link target' };
  const res = guardRoute(route, cap);
  return { ...res, route };
}

/**
 * Authorize a deep-link URL before navigating. Unknown hosts, admin
 * consoles, and anything without a mobile route are refused. Mutating
 * targets additionally require a FRESH snapshot (a stale cached session
 * may still view read-only routes).
 */
export function guardDeepLink(url: string, cap: CapabilitySnapshot | null): DeepLinkVerdict {
  // Same URL shapes as linking.ts (kept dependency-free so guards stay
  // unit-testable without the native router). Unknown hosts, admin
  // consoles, and anything without a mobile route are refused.
  const m = /^(?:elogbook:\/\/|https:\/\/elogbook\.app\/)([a-z-]+)(?:\/[^?#]*)?/i.exec(url.trim());
  const route = m?.[1]?.toLowerCase() ? DEEP_LINK_ROUTES[m[1].toLowerCase() as string] : undefined;
  if (!route) return { allowed: false, reason: 'unsupported link target' };
  const guard = ROUTE_GUARDS[route];
  if (guard.action !== 'read' && cap && !isCapabilityFresh(cap)) {
    return { allowed: false, route, reason: 'stale session — refresh required' };
  }
  const res = guardRoute(route, cap);
  return res.ok ? { allowed: true, route } : { allowed: false, route, reason: res.reason };
}
