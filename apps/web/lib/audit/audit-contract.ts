/**
 * Audit write contract shared by every server-side audit caller.
 *
 * The `audit_logs` INSERT policy installed by
 * 20260824110000_audit_logs_trigger_depth_insert.sql only admits rows written
 * from inside a trigger (`pg_trigger_depth() >= 1`). A direct PostgREST insert
 * from a request-scoped client therefore always fails with 42501, which is why
 * audit writes must go through the `write_audit_event` RPC. This module is the
 * single place that decides whether an audit event is structurally allowed, so
 * the web route, the client component and the mobile queue all reject the same
 * malformed or PHI-bearing payloads before a request leaves the process.
 *
 * SECURITY: audit rows are metadata only. Resident/reviewer names, MRNs, DOBs,
 * free-text `field_values` and approval comments are rejected outright rather
 * than truncated, because a partially redacted audit trail is still a PHI
 * container.
 */

export const AUDIT_METADATA_ONLY_RESOURCE_TYPES = [
  'tenant',
  'audit_trail',
  'session',
  'system',
  'mobile_buffer',
] as const;

export const AUDIT_PHI_DENYLIST = [
  'field_values',
  'patient_mrn',
  'patient_dob',
  'patient_name',
  'mrn',
  'dob',
  'full_name',
  'resident_name',
  'reviewer_name',
  'evaluator_name',
  'comment',
  'comments',
  'note',
  'notes',
  'free_text',
  'row',
  'new',
  'old',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[a-z][a-z0-9_]{0,63}$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,47}$/;

const MAX_VALUE_LENGTH = 512;
const MAX_ARRAY_LENGTH = 32;
const MAX_CHANGES_BYTES = 4096;
const MAX_CHANGES_KEYS = 64;

export type AuditRejectionReason =
  | 'action_invalid'
  | 'resource_type_invalid'
  | 'resource_id_required'
  | 'resource_id_invalid'
  | 'tenant_id_invalid'
  | 'changes_not_object'
  | 'changes_key_invalid'
  | 'changes_phi_denied'
  | 'changes_value_invalid'
  | 'changes_nested'
  | 'changes_too_large';

export type AuditChangesResult =
  | { ok: true; changes: Record<string, unknown> }
  | { ok: false; reason: AuditRejectionReason };

export type AuditRpcArgs = {
  p_action: string;
  p_resource_type: string;
  p_resource_id: string | null;
  p_changes: Record<string, unknown>;
  p_tenant_id: string;
};

export type BuildAuditRpcResult =
  | { ok: true; args: AuditRpcArgs }
  | { ok: false; reason: AuditRejectionReason };

export interface AuditEventInput {
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: Record<string, unknown>;
  tenantId: string;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isMetadataOnlyResourceType(value: string): boolean {
  return (AUDIT_METADATA_ONLY_RESOURCE_TYPES as readonly string[]).includes(value);
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'number'
    || (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH)
  );
}

export function sanitizeAuditChanges(input: unknown): AuditChangesResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'changes_not_object' };
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_CHANGES_KEYS) return { ok: false, reason: 'changes_too_large' };

  const denylist = new Set<string>(AUDIT_PHI_DENYLIST);
  const changes: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    if (!KEY_RE.test(key)) return { ok: false, reason: 'changes_key_invalid' };
    if (denylist.has(key)) return { ok: false, reason: 'changes_phi_denied' };
    if (Array.isArray(value)) {
      if (value.some((item) => item !== null && typeof item === 'object')) {
        return { ok: false, reason: 'changes_nested' };
      }
      if (value.length > MAX_ARRAY_LENGTH || !value.every((item) => isPrimitive(item))) {
        return { ok: false, reason: 'changes_value_invalid' };
      }
      changes[key] = value;
      continue;
    }
    if (value !== null && typeof value === 'object') return { ok: false, reason: 'changes_nested' };
    if (!isPrimitive(value)) return { ok: false, reason: 'changes_value_invalid' };
    changes[key] = value;
  }

  if (JSON.stringify(changes).length > MAX_CHANGES_BYTES) {
    return { ok: false, reason: 'changes_too_large' };
  }

  return { ok: true, changes };
}

export function buildAuditRpcArgs(input: AuditEventInput): BuildAuditRpcResult {
  if (!TOKEN_RE.test(input.action)) return { ok: false, reason: 'action_invalid' };
  if (!TOKEN_RE.test(input.resourceType)) return { ok: false, reason: 'resource_type_invalid' };
  if (!isUuid(input.tenantId)) return { ok: false, reason: 'tenant_id_invalid' };

  let resourceId: string | null = null;
  if (input.resourceId === null || input.resourceId === undefined) {
    if (!isMetadataOnlyResourceType(input.resourceType)) {
      return { ok: false, reason: 'resource_id_required' };
    }
  } else if (!isUuid(input.resourceId)) {
    return { ok: false, reason: 'resource_id_invalid' };
  } else {
    resourceId = input.resourceId;
  }

  const changes = sanitizeAuditChanges(input.changes);
  if (!changes.ok) return { ok: false, reason: changes.reason };

  return {
    ok: true,
    args: {
      p_action: input.action,
      p_resource_type: input.resourceType,
      p_resource_id: resourceId,
      p_changes: changes.changes,
      p_tenant_id: input.tenantId,
    },
  };
}
