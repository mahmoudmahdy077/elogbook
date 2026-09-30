import { describe, it, expect, vi } from 'vitest';
import { recordAuditEvent, AuditWriteError } from '../write-audit-event';
import type { AuditEventInput } from '../audit-contract';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

function input(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    action: 'audit_export',
    resourceType: 'tenant',
    resourceId: null,
    changes: { row_count: 2 },
    tenantId: TENANT_ID,
    ...overrides,
  };
}

function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as Parameters<typeof recordAuditEvent>[0];
}

describe('recordAuditEvent', () => {
  it('writes through the trusted write_audit_event RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'row-1', error: null });

    const result = await recordAuditEvent(client(rpc), input());

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('write_audit_event', {
      p_action: 'audit_export',
      p_resource_type: 'tenant',
      p_resource_id: null,
      p_changes: { row_count: 2 },
      p_tenant_id: TENANT_ID,
    });
  });

  it('never calls the audit_logs table directly', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'row-1', error: null });
    const from = vi.fn();

    await recordAuditEvent({ rpc, from } as unknown as Parameters<typeof recordAuditEvent>[0], input());

    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed without issuing a request when the payload is malformed', async () => {
    const rpc = vi.fn();

    await expect(
      recordAuditEvent(client(rpc), input({ resourceType: 'case_entries', resourceId: 'a,b' })),
    ).rejects.toBeInstanceOf(AuditWriteError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the payload carries PHI', async () => {
    const rpc = vi.fn();

    await expect(
      recordAuditEvent(client(rpc), input({ changes: { field_values: { dx: 'x' } } })),
    ).rejects.toMatchObject({ reason: 'changes_phi_denied' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the RPC returns an error without leaking the database message', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'new row violates row-level security policy for table "audit_logs"' },
    });

    const error = await recordAuditEvent(client(rpc), input()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuditWriteError);
    expect((error as AuditWriteError).reason).toBe('audit_write_failed');
    expect((error as AuditWriteError).message).toBe('audit_write_failed');
    expect(JSON.stringify((error as AuditWriteError))).not.toContain('row-level security');
  });

  it('fails closed when the RPC throws', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('JWT expired'));

    const error = await recordAuditEvent(client(rpc), input()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuditWriteError);
    expect((error as AuditWriteError).message).toBe('audit_write_failed');
  });

  it('treats a null data result as a failed write', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await expect(recordAuditEvent(client(rpc), input())).rejects.toBeInstanceOf(AuditWriteError);
  });

  it('accepts a row-scoped resource id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'row-1', error: null });

    await recordAuditEvent(
      client(rpc),
      input({ resourceType: 'case_entries', resourceId: PROFILE_ID }),
    );

    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_resource_id: PROFILE_ID });
  });
});
