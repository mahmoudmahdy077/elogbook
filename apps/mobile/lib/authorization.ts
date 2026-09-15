/**
 * M1.4 — screen-level authorization adapters.
 *
 * Client-side UX gates only. Every check needs a FRESH server capability
 * snapshot; server denial (RLS/RPC) remains authoritative. Role strings are
 * display hints used here solely to hide unsupported affordances.
 */

import { isCapabilityFresh, requiresStepUp, type CapabilitySnapshot } from './capability';

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
  | 'admin:tenant';

export interface GateResult {
  ok: boolean;
  reason?: string;
}

const APPROVER_ROLES = new Set(['supervisor', 'director', 'institution_admin', 'admin']);

export function canPerform(cap: CapabilitySnapshot | null, action: SensitiveAction): GateResult {
  if (!cap) return { ok: false, reason: 'no session capability' };
  if (cap.status !== 'active') return { ok: false, reason: `account ${cap.status}` };
  if (cap.expiresAt !== null && Date.now() > cap.expiresAt) return { ok: false, reason: 'session expired' };

  const sensitive: SensitiveAction[] = ['case:approve', 'export:identifiable', 'admin:tenant'];
  if (sensitive.includes(action) && !isCapabilityFresh(cap)) {
    return { ok: false, reason: 'stale capability — refresh required' };
  }

  switch (action) {
    case 'case:create':
    case 'case:edit':
    case 'case:delete':
    case 'evaluation:create':
    case 'duty:create':
    case 'export:deidentified':
    case 'ai:insights':
    case 'attachment:upload':
      return { ok: true };
    case 'case:approve':
      if (!APPROVER_ROLES.has(cap.role)) return { ok: false, reason: 'approver role required' };
      return { ok: true };
    case 'export:identifiable':
      if (cap.dataMode !== 'identifiable') return { ok: false, reason: 'tenant is de-identified mode' };
      if (requiresStepUp(cap, 'export_identifiable')) return { ok: false, reason: 'step-up authentication required' };
      return { ok: true };
    case 'admin:tenant':
      if (!APPROVER_ROLES.has(cap.role)) return { ok: false, reason: 'admin role required' };
      if (!isCapabilityFresh(cap)) return { ok: false, reason: 'stale capability — refresh required' };
      return { ok: true };
  }
}
