import { hasServerAal2, isCapabilityFresh, requiresStepUp, type CapabilitySnapshot } from './capability';

export type SensitiveAction =
  | 'case:create'
  | 'case:edit'
  | 'case:delete'
  | 'case:approve'
  | 'evaluation:create'
  | 'duty:create'
  | 'export:identifiable'
  | 'export:deidentified'
  | 'ai:insights'
  | 'attachment:upload'
  | 'tenant:read'
  | 'tenant:mutate'
  | 'admin:tenant';

export interface GateResult {
  ok: boolean;
  reason?: string;
}

const APPROVER_ROLES = new Set(['supervisor', 'director', 'institution_admin', 'admin']);
const AAL2_ACTIONS = new Set<SensitiveAction>([
  'case:approve',
  'evaluation:create',
  'duty:create',
  'export:identifiable',
  'export:deidentified',
  'ai:insights',
  'attachment:upload',
  'tenant:read',
  'tenant:mutate',
  'admin:tenant',
]);

export function canPerform(cap: CapabilitySnapshot | null, action: SensitiveAction): GateResult {
  if (!cap) return { ok: false, reason: 'no session capability' };
  if (!cap.userId || !cap.profileId) return { ok: false, reason: 'identity not verified' };
  if (!cap.tenantId) return { ok: false, reason: 'tenant not verified' };
  if (cap.status !== 'active') return { ok: false, reason: `account ${cap.status}` };
  if (cap.tenantStatus !== 'active') return { ok: false, reason: `tenant ${cap.tenantStatus}` };
  if (cap.expiresAt !== null && Date.now() > cap.expiresAt) return { ok: false, reason: 'session expired' };

  if (AAL2_ACTIONS.has(action) && !isCapabilityFresh(cap)) {
    return { ok: false, reason: 'stale capability — refresh required' };
  }
  if (AAL2_ACTIONS.has(action) && !hasServerAal2(cap)) {
    return { ok: false, reason: 'step-up authentication required' };
  }

  switch (action) {
    case 'case:create':
    case 'case:edit':
    case 'case:delete':
      return { ok: true };
    case 'evaluation:create':
    case 'duty:create':
    case 'export:deidentified':
    case 'ai:insights':
    case 'attachment:upload':
    case 'tenant:read':
    case 'tenant:mutate':
      return { ok: true };
    case 'case:approve':
      if (!APPROVER_ROLES.has(cap.role)) return { ok: false, reason: 'approver role required' };
      if (requiresStepUp(cap, 'decide_case')) return { ok: false, reason: 'step-up authentication required' };
      return { ok: true };
    case 'export:identifiable':
      if (cap.dataMode !== 'identifiable') return { ok: false, reason: 'tenant is de-identified mode' };
      if (requiresStepUp(cap, 'export_identifiable')) return { ok: false, reason: 'step-up authentication required' };
      return { ok: true };
    case 'admin:tenant':
      if (!APPROVER_ROLES.has(cap.role)) return { ok: false, reason: 'admin role required' };
      if (requiresStepUp(cap, 'manage_tenant')) return { ok: false, reason: 'step-up authentication required' };
      return { ok: true };
  }
}
