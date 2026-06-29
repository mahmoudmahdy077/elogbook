import { describe, it, expect } from 'vitest';
import { logger, redactPHI } from '../logger';

describe('logger PHI redactor', () => {
  it('redacts known PHI keys at the top level', () => {
    const out = redactPHI({ patient_mrn: '12345', name: 'Test' }) as Record<string, unknown>;
    expect(out.patient_mrn).toBe('[REDACTED]');
    expect(out.name).toBe('Test');
  });

  it('redacts nested PHI keys', () => {
    const out = redactPHI({
      tenant: { id: 't-1' },
      case: { patient_mrn: '12345', field_values: { x: 1 } },
    }) as Record<string, unknown>;
    const c = out.case as Record<string, unknown>;
    expect(c.patient_mrn).toBe('[REDACTED]');
    expect(c.field_values).toBe('[REDACTED]');
  });

  it('handles arrays of objects', () => {
    const out = redactPHI([{ patient_dob: '2000-01-01' }, { safe: 1 }]) as Record<string, unknown>[];
    expect(out[0].patient_dob).toBe('[REDACTED]');
    expect(out[1].safe).toBe(1);
  });

  it('is case-insensitive on the key name', () => {
    const out = redactPHI({ PATIENT_MRN: 'x' }) as Record<string, unknown>;
    expect(out.PATIENT_MRN).toBe('[REDACTED]');
  });

  it('passes through null/undefined', () => {
    expect(redactPHI(null)).toBe(null);
    expect(redactPHI(undefined)).toBe(undefined);
  });

  it('caps recursion depth', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const out = redactPHI(circular);
    expect(out).toBeDefined();
  });
});

describe('logger interface', () => {
  it('exposes debug/info/warn/error', () => {
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('accepts an Error in error()', () => {
    const e = new Error('boom');
    expect(() => logger.error(e, { route: '/x' })).not.toThrow();
  });
});
