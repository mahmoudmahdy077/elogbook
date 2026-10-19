import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  clinicalCommandLog,
  resolveCorrelationId,
} from '@/lib/observability/correlation-id';

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe('resolveCorrelationId', () => {
  it('generates a UUID correlation id when the header is absent', () => {
    const id = resolveCorrelationId(headers({}));

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('accepts a well-formed x-correlation-id from the caller', () => {
    const supplied = 'corr-9f2b7c1d4e5a';

    expect(resolveCorrelationId(headers({ 'x-correlation-id': supplied }))).toBe(supplied);
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(129)],
    ['log injection via newline', 'abc\ndefghij'],
    ['log injection via carriage return', 'abc\rdefghij'],
    ['embedded space', 'abc defghij'],
    ['tab character', 'abc\tdefghij'],
    ['path traversal characters', '../../etc/passwd'],
    ['sql metacharacters', "abc'; DROP TABLE--x"],
    ['template metacharacters', 'abc${jndi:ldap}x'],
  ])('rejects a correlation id with %s', (_label, supplied) => {
    const resolved = resolveCorrelationId({ 'x-correlation-id': supplied });

    expect(resolved).not.toBe(supplied);
    expect(resolved).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('rejects a header object holding an array of correlation ids', () => {
    const resolved = resolveCorrelationId({ 'x-correlation-id': ['corr-first', 'corr-second'] });

    expect(resolved).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('survives a hostile value the Headers layer would refuse outright', () => {
    let hostile: string | null = null;
    try {
      new Headers({ 'x-correlation-id': 'abc\ndefghij' });
    } catch {
      hostile = 'abc\ndefghij';
    }

    if (hostile !== null) {
      expect(resolveCorrelationId({ 'x-correlation-id': hostile })).not.toBe(hostile);
    }
  });
});

describe('clinicalCommandLog', () => {
  it('logs only the allow-listed bounded fields', () => {
    const log = clinicalCommandLog({
      command: 'decide_case',
      caseId: '00000000-0000-0000-0000-000000003241',
      tenantId: '00000000-0000-0000-0000-000000003201',
      durationMs: 42,
      resultCode: 'approved',
      correlationId: 'corr-9f2b7c1d4e5a',
    });

    expect(Object.keys(log).sort()).toEqual([
      'caseId',
      'command',
      'correlationId',
      'durationMs',
      'resultCode',
      'tenantId',
    ]);
  });

  it('never emits clinical field values, rejection text, or provider responses', () => {
    const log = clinicalCommandLog({
      command: 'submit_case',
      caseId: '00000000-0000-0000-0000-000000003241',
      tenantId: '00000000-0000-0000-0000-000000003201',
      durationMs: 7,
      resultCode: 'rejected',
      correlationId: 'corr-9f2b7c1d4e5a',
      fieldValues: { date_of_birth: '1980-01-01' },
      reason: 'patient declined treatment',
      providerResponse: { smtp: '250 rejected' },
    });

    const serialized = JSON.stringify(log);

    expect(serialized).not.toContain('1980-01-01');
    expect(serialized).not.toContain('patient declined');
    expect(serialized).not.toContain('smtp');
    expect(Object.keys(log)).not.toContain('fieldValues');
    expect(Object.keys(log)).not.toContain('reason');
    expect(Object.keys(log)).not.toContain('providerResponse');
  });

  it('never uses a client request_id as the correlation id', () => {
    const clientRequestId = 'client-supplied-request-id';

    const log = clinicalCommandLog({
      command: 'decide_case',
      caseId: '00000000-0000-0000-0000-000000003241',
      tenantId: '00000000-0000-0000-0000-000000003201',
      durationMs: 11,
      resultCode: 'state_conflict',
      correlationId: randomUUID(),
      requestId: clientRequestId,
    });

    expect(log.correlationId).not.toBe(clientRequestId);
    expect(Object.keys(log)).not.toContain('requestId');
    expect(JSON.stringify(log)).not.toContain(clientRequestId);
  });
});
