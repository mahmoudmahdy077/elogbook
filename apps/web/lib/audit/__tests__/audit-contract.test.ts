import { describe, it, expect } from 'vitest';
import {
  AUDIT_METADATA_ONLY_RESOURCE_TYPES,
  AUDIT_PHI_DENYLIST,
  buildAuditRpcArgs,
  isUuid,
  sanitizeAuditChanges,
} from '../audit-contract';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

describe('isUuid', () => {
  it('accepts a canonical uuid', () => {
    expect(isUuid(PROFILE_ID)).toBe(true);
  });

  it('rejects a comma joined id list', () => {
    expect(isUuid(`${PROFILE_ID},${TENANT_ID}`)).toBe(false);
  });

  it('rejects non-uuid tokens', () => {
    expect(isUuid('entry-1')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('sanitizeAuditChanges', () => {
  it('keeps opaque scalar metadata', () => {
    const result = sanitizeAuditChanges({ row_count: 3, format: 'csv', nested: null });
    expect(result).toEqual({ ok: true, changes: { row_count: 3, format: 'csv', nested: null } });
  });

  it('keeps short primitive arrays', () => {
    const result = sanitizeAuditChanges({ changed_fields: ['status', 'template_id'] });
    expect(result).toEqual({ ok: true, changes: { changed_fields: ['status', 'template_id'] } });
  });

  it.each(AUDIT_PHI_DENYLIST)('rejects the PHI-bearing key %s', (key) => {
    const result = sanitizeAuditChanges({ [key]: 'sensitive' });
    expect(result.ok).toBe(false);
  });

  it('rejects a PHI key nested under a metadata key', () => {
    const result = sanitizeAuditChanges({ field_values: { dx: 'appendicitis' } });
    expect(result.ok).toBe(false);
  });

  it('rejects a nested object', () => {
    const result = sanitizeAuditChanges({ detail: { status: 'approved' } });
    expect(result).toEqual({ ok: false, reason: 'changes_nested' });
  });

  it('rejects an array of objects', () => {
    const result = sanitizeAuditChanges({ rows: [{ id: '1' }] });
    expect(result).toEqual({ ok: false, reason: 'changes_nested' });
  });

  it('rejects a non-object payload', () => {
    expect(sanitizeAuditChanges('approved')).toEqual({ ok: false, reason: 'changes_not_object' });
    expect(sanitizeAuditChanges([1, 2])).toEqual({ ok: false, reason: 'changes_not_object' });
    expect(sanitizeAuditChanges(null)).toEqual({ ok: false, reason: 'changes_not_object' });
  });

  it('rejects a non-snake-case key', () => {
    expect(sanitizeAuditChanges({ 'Row Count': 2 })).toEqual({ ok: false, reason: 'changes_key_invalid' });
  });

  it('rejects an over-long string value', () => {
    expect(sanitizeAuditChanges({ format: 'c'.repeat(513) })).toEqual({ ok: false, reason: 'changes_value_invalid' });
  });

  it('rejects an over-long array', () => {
    expect(sanitizeAuditChanges({ ids: Array.from({ length: 33 }, (_, i) => String(i)) })).toEqual({
      ok: false,
      reason: 'changes_value_invalid',
    });
  });

  it('rejects an oversized payload', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`k${i}`, 'v'.repeat(100)]),
    );
    expect(sanitizeAuditChanges(wide)).toEqual({ ok: false, reason: 'changes_too_large' });
  });
});

describe('buildAuditRpcArgs', () => {
  it('builds trusted-path arguments for a row-scoped resource', () => {
    expect(
      buildAuditRpcArgs({
        action: 'audit_export',
        resourceType: 'case_entries',
        resourceId: PROFILE_ID,
        changes: { row_count: 1 },
        tenantId: TENANT_ID,
      }),
    ).toEqual({
      ok: true,
      args: {
        p_action: 'audit_export',
        p_resource_type: 'case_entries',
        p_resource_id: PROFILE_ID,
        p_changes: { row_count: 1 },
        p_tenant_id: TENANT_ID,
      },
    });
  });

  it('permits a null resource id only for an explicit metadata-only resource type', () => {
    for (const resourceType of AUDIT_METADATA_ONLY_RESOURCE_TYPES) {
      expect(
        buildAuditRpcArgs({
          action: 'audit_export',
          resourceType,
          resourceId: null,
          changes: {},
          tenantId: TENANT_ID,
        }).ok,
      ).toBe(true);
    }
  });

  it('rejects a null resource id for a row-scoped resource type', () => {
    const result = buildAuditRpcArgs({
      action: 'audit_export',
      resourceType: 'case_entries',
      resourceId: null,
      changes: {},
      tenantId: TENANT_ID,
    });
    expect(result).toEqual({ ok: false, reason: 'resource_id_required' });
  });

  it('rejects a non-uuid resource id', () => {
    const result = buildAuditRpcArgs({
      action: 'pdf_export',
      resourceType: 'case_entries',
      resourceId: 'a,b',
      changes: {},
      tenantId: TENANT_ID,
    });
    expect(result).toEqual({ ok: false, reason: 'resource_id_invalid' });
  });

  it('rejects a non-uuid tenant id', () => {
    const result = buildAuditRpcArgs({
      action: 'pdf_export',
      resourceType: 'tenant',
      resourceId: null,
      changes: {},
      tenantId: 'tenant-1',
    });
    expect(result).toEqual({ ok: false, reason: 'tenant_id_invalid' });
  });

  it('rejects a non-uuid tenant id even when the tenant is omitted', () => {
    // The type requires a tenant, but a caller assembled from parsed JSON can
    // still omit it. That has to fail closed rather than build an audit event.
    const result = buildAuditRpcArgs({
      action: 'pdf_export',
      resourceType: 'tenant',
      resourceId: null,
      changes: {},
      tenantId: undefined,
    } as unknown as Parameters<typeof buildAuditRpcArgs>[0]);
    expect(result).toEqual({ ok: false, reason: 'tenant_id_invalid' });
  });

  it('rejects an action that is not a snake_case token', () => {
    const result = buildAuditRpcArgs({
      action: 'Approved By Jane',
      resourceType: 'tenant',
      resourceId: null,
      changes: {},
      tenantId: TENANT_ID,
    });
    expect(result).toEqual({ ok: false, reason: 'action_invalid' });
  });

  it('rejects a resource type that is not a snake_case token', () => {
    const result = buildAuditRpcArgs({
      action: 'pdf_export',
      resourceType: 'Case Entries',
      resourceId: null,
      changes: {},
      tenantId: TENANT_ID,
    });
    expect(result).toEqual({ ok: false, reason: 'resource_type_invalid' });
  });

  it('propagates the changes rejection reason', () => {
    const result = buildAuditRpcArgs({
      action: 'pdf_export',
      resourceType: 'tenant',
      resourceId: null,
      changes: { field_values: { dx: 'x' } },
      tenantId: TENANT_ID,
    });
    expect(result).toEqual({ ok: false, reason: 'changes_phi_denied' });
  });
});
