import { canPerform, type SensitiveAction } from './authorization';
import { isCapabilityFresh } from './capability';
import type { CapabilitySnapshot } from './capability';

export type RouteName =
  | 'index' | 'log-case' | 'my-cases' | 'case-detail' | 'approvals'
  | 'evaluations' | 'duty-hours' | 'rotations' | 'milestones'
  | 'analytics' | 'ai-insights' | 'profile';

export interface RouteGuard {
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
  rotations: { action: 'tenant:read' },
  milestones: { action: 'tenant:read' },
  analytics: { action: 'tenant:read' },
  'ai-insights': { action: 'ai:insights' },
  profile: { action: 'read' },
};

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

function actionForRoute(route: RouteName, cap: CapabilitySnapshot): SensitiveAction | 'read' {
  if ((route === 'analytics' || route === 'rotations' || route === 'milestones') && cap.role !== 'resident') {
    return 'tenant:read';
  }
  if ((route === 'index' || route === 'case-detail') && cap.role !== 'resident') return 'tenant:read';
  return route === 'analytics' || route === 'rotations' || route === 'milestones' ? 'read' : ROUTE_GUARDS[route].action;
}

export function guardRoute(route: RouteName, cap: CapabilitySnapshot | null): GuardResult {
  if (!cap) return { ok: false, reason: 'no session capability' };
  if (!cap.userId || !cap.profileId || !cap.tenantId || cap.status !== 'active' || cap.tenantStatus !== 'active') {
    return { ok: false, reason: 'account or tenant is not active' };
  }
  const action = actionForRoute(route, cap);
  if (action === 'read') return { ok: true };
  return canPerform(cap, action);
}

export interface DeepLinkVerdict {
  allowed: boolean;
  route?: RouteName;
  reason?: string;
}

export function routeForPathname(pathname: string): RouteName | null {
  const m = /^\(tabs\)\/([a-z-]+)/i.exec(pathname.replace(/^\//, ''));
  if (!m) {
    if (/^\(tabs\)$/i.test(pathname.replace(/^\//, ''))) return 'index';
    return null;
  }
  const name = m[1].toLowerCase() as RouteName;
  return name in ROUTE_GUARDS ? name : null;
}

export function guardPathname(pathname: string, cap: CapabilitySnapshot | null): GuardResult & { route?: RouteName } {
  const route = routeForPathname(pathname);
  if (!route) return { ok: false, reason: 'unsupported link target' };
  const res = guardRoute(route, cap);
  return { ...res, route };
}

export function guardDeepLink(url: string, cap: CapabilitySnapshot | null): DeepLinkVerdict {
  const m = /^(?:elogbook:\/\/|https:\/\/elogbook\.app\/)([a-z-]+)(?:\/[^?#]*)?/i.exec(url.trim());
  const route = m?.[1]?.toLowerCase() ? DEEP_LINK_ROUTES[m[1].toLowerCase() as string] : undefined;
  if (!route || !cap) return { allowed: false, reason: 'unsupported link target' };
  const action = actionForRoute(route, cap);
  if (action !== 'read' && !isCapabilityFresh(cap)) {
    return { allowed: false, route, reason: 'stale session — refresh required' };
  }
  const res = guardRoute(route, cap);
  return res.ok ? { allowed: true, route } : { allowed: false, route, reason: res.reason };
}
