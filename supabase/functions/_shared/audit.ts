/**
 * Edge-function audit writer.
 *
 * The `audit_logs` INSERT policy installed by
 * 20260824110000_audit_logs_trigger_depth_insert.sql only admits rows written
 * from inside a trigger, so a direct `serviceRole.from('audit_logs').insert()`
 * was the previous (unreliable) escape hatch. `write_audit_event` is the
 * authenticated, tenant-authorized trusted path — see
 * 20260927000000_audit_write_authority.sql.
 *
 * The function validates the structural invariants before spending a request
 * (uuid resource id or an explicit metadata-only resource type, snake_case
 * tokens, flat metadata-only changes). PHI-bearing keys are refused by the
 * database as the authoritative check; edge code never constructs such a
 * payload, and any failure surfaces as a stable `audit_write_failed` code so
 * no Postgres text reaches a caller.
 */

export const AUDIT_WRITE_RPC = 'write_audit_event';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[a-z][a-z0-9_]{0,63}$/;

export const AUDIT_METADATA_ONLY_RESOURCE_TYPES = [
  'tenant',
  'audit_trail',
  'session',
  'system',
  'mobile_buffer',
] as const;

export interface EdgeAuditRpcResult {
  data?: unknown;
  error?: unknown;
}

export interface EdgeAuditClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<EdgeAuditRpcResult>;
}

export interface EdgeAuditEvent {
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: Record<string, unknown>;
  tenantId: string;
}

export class AuditWriteError extends Error {
  constructor() {
    super('audit_write_failed');
    this.name = 'AuditWriteError';
  }
}

function isMetadataOnly(resourceType: string): boolean {
  return (AUDIT_METADATA_ONLY_RESOURCE_TYPES as readonly string[]).includes(resourceType);
}

function assertFlatChanges(changes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(changes)) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) throw new AuditWriteError();
    if (value !== null && typeof value === 'object') throw new AuditWriteError();
  }
}

export async function writeAuditEvent(
  client: EdgeAuditClient,
  event: EdgeAuditEvent,
): Promise<string> {
  if (!TOKEN_RE.test(event.action)) throw new AuditWriteError();
  if (!TOKEN_RE.test(event.resourceType)) throw new AuditWriteError();
  if (!UUID_RE.test(event.tenantId)) throw new AuditWriteError();
  if (event.resourceId === null) {
    if (!isMetadataOnly(event.resourceType)) throw new AuditWriteError();
  } else if (!UUID_RE.test(event.resourceId)) {
    throw new AuditWriteError();
  }
  assertFlatChanges(event.changes);

  let result: EdgeAuditRpcResult;
  try {
    result = await client.rpc(AUDIT_WRITE_RPC, {
      p_action: event.action,
      p_resource_type: event.resourceType,
      p_resource_id: event.resourceId,
      p_changes: event.changes,
      p_tenant_id: event.tenantId,
    });
  } catch {
    throw new AuditWriteError();
  }

  if (result?.error || typeof result?.data !== 'string' || result.data.length === 0) {
    throw new AuditWriteError();
  }
  return result.data;
}
