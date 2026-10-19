import { logger } from '@/lib/logger';
import {
  buildAuditRpcArgs,
  type AuditEventInput,
  type AuditRejectionReason,
} from './audit-contract';

export const AUDIT_WRITE_RPC = 'write_audit_event';

type RpcResult = { data?: unknown; error?: unknown } | null | undefined;

export type AuditWriteClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

/**
 * Raised for every audit-write failure. The message is a stable machine code so
 * route handlers can map it to a generic 500 without echoing a Postgres error
 * (constraint names, policy names, JWT claims) to the caller.
 */
export class AuditWriteError extends Error {
  readonly reason: AuditRejectionReason | 'audit_write_failed';

  constructor(reason: AuditRejectionReason | 'audit_write_failed') {
    super(reason);
    this.name = 'AuditWriteError';
    this.reason = reason;
  }
}

export async function recordAuditEvent(
  supabase: AuditWriteClient,
  input: AuditEventInput,
): Promise<{ ok: true; auditId: string }> {
  const built = buildAuditRpcArgs(input);
  if (!built.ok) throw new AuditWriteError(built.reason);

  let result: RpcResult;
  try {
    result = await supabase.rpc(AUDIT_WRITE_RPC, built.args);
  } catch {
    throw new AuditWriteError('audit_write_failed');
  }

  if (result?.error || typeof result?.data !== 'string' || result.data.length === 0) {
    throw new AuditWriteError('audit_write_failed');
  }

  return { ok: true, auditId: result.data };
}

/**
 * Fail-closed helper for export and disclosure paths: a required audit event
 * that cannot be written must abort the operation rather than release PHI
 * without a record. Only the stable code is logged.
 */
export async function requireAuditEvent(
  supabase: AuditWriteClient,
  input: AuditEventInput,
): Promise<{ ok: true; auditId: string }> {
  try {
    return await recordAuditEvent(supabase, input);
  } catch (error) {
    if (error instanceof AuditWriteError) {
      logger.error('required audit write failed', new Error(error.reason), {
        auditAction: input.action,
      });
    } else {
      logger.error('required audit write failed', error, { auditAction: input.action });
    }
    throw new AuditWriteError('audit_write_failed');
  }
}
