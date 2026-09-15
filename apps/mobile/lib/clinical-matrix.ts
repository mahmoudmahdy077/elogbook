/**
 * M4 — role/mode/route matrix for the qualified mobile release.
 *
 * Supported surfaces are tested on-device per role and mode; unsupported
 * admin consoles are unavailable in the app AND server-denied (RLS/RPC).
 * Every mutating route implements loading/empty/error/offline/retry,
 * expired-session, suspended-tenant, policy-change, and
 * destructive-confirm states.
 */

export type MatrixRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';
export type MatrixMode = 'identifiable' | 'deidentified';
export type ScreenState =
  | 'loading'
  | 'success'
  | 'empty'
  | 'error'
  | 'offline'
  | 'queued'
  | 'retry'
  | 'denied'
  | 'expired-session'
  | 'suspended-tenant'
  | 'policy-change'
  | 'malformed'
  | 'conflict'
  | 'destructive-confirm';

export interface MatrixRow {
  route: string;
  roles: MatrixRole[];
  modes: MatrixMode[];
  states: ScreenState[];
}

const BASE_STATES: ScreenState[] = ['loading', 'success', 'empty', 'error', 'offline', 'queued', 'retry', 'denied', 'expired-session', 'suspended-tenant', 'policy-change', 'malformed', 'conflict'];
const MUTATING: ScreenState[] = [...BASE_STATES, 'destructive-confirm'];

export const CLINICAL_MATRIX: MatrixRow[] = [
  { route: 'login', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
  { route: 'index', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
  { route: 'log-case', roles: ['resident'], modes: ['identifiable', 'deidentified'], states: MUTATING },
  { route: 'my-cases', roles: ['resident'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
  { route: 'case-detail', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
  { route: 'approvals', roles: ['supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: MUTATING },
  { route: 'evaluations', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: MUTATING },
  { route: 'duty-hours', roles: ['resident'], modes: ['identifiable', 'deidentified'], states: MUTATING },
  { route: 'rotations', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
  { route: 'milestones', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
  { route: 'analytics', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
  { route: 'ai-insights', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
  { route: 'profile', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'], modes: ['identifiable', 'deidentified'], states: BASE_STATES },
];

export interface UnsupportedSurface {
  surface: string;
  reason: string;
  serverDenied: boolean;
}

export function unsupportedSurfaces(): UnsupportedSurface[] {
  return [
    {
      surface: 'tenant-admin console',
      reason: 'No tenant-admin screens ship in mobile; tenant APIs require tenant-admin role server-side.',
      serverDenied: true,
    },
    {
      surface: 'platform-admin console',
      reason: 'No platform-admin screens ship in mobile; platform APIs require platform-admin grant server-side.',
      serverDenied: true,
    },
    {
      surface: 'bulk export',
      reason: 'No bulk-export action ships in mobile; export endpoints enforce mode + step-up server-side.',
      serverDenied: true,
    },
  ];
}
