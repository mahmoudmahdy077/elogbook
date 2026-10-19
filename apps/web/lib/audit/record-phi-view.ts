import { logger } from '@/lib/logger';
import { isUuid } from './audit-contract';
import { recordAuditEvent } from './write-audit-event';

/**
 * A PHI reveal is a disclosure event. It is written through the trusted
 * `write_audit_event` RPC (a direct `audit_logs` insert is rejected by the
 * trigger-depth INSERT policy) and it fails closed: if the audit row cannot be
 * written, the caller must not reveal the value.
 */

export type PhiField = 'mrn' | 'dob';

export interface PhiViewInput {
  entryId: string;
  tenantId: string;
  field: PhiField;
}

export async function recordPhiView(
  supabase: Parameters<typeof recordAuditEvent>[0],
  input: PhiViewInput,
): Promise<boolean> {
  if (input.field !== 'mrn' && input.field !== 'dob') return false;
  if (!isUuid(input.entryId) || !isUuid(input.tenantId)) return false;

  try {
    await recordAuditEvent(supabase, {
      action: 'phi_view',
      resourceType: 'case_entries',
      resourceId: input.entryId,
      tenantId: input.tenantId,
      changes: { field: input.field },
    });
    return true;
  } catch (error) {
    if (error instanceof Error) {
      logger.error('PHI view audit write failed; value withheld', error, {
        auditAction: 'phi_view',
      });
    }
    return false;
  }
}
