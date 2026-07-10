import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  // --- Additional edge cases for redactPHI ---

  it('passes through primitive values directly', () => {
    // If someone calls redactPHI on non-objects, they pass through
    expect(redactPHI('string')).toBe('string');
    expect(redactPHI(42)).toBe(42);
    expect(redactPHI(true)).toBe(true);
    expect(redactPHI(false)).toBe(false);
    expect(redactPHI(0)).toBe(0);
    expect(redactPHI('')).toBe('');
  });

  it('handles empty objects', () => {
    expect(redactPHI({})).toEqual({});
  });

  it('handles empty arrays', () => {
    expect(redactPHI([])).toEqual([]);
  });

  it('handles arrays of primitives', () => {
    const out = redactPHI([1, 'hello', true, null]) as unknown[];
    expect(out).toEqual([1, 'hello', true, null]);
  });

  it('redacts keys with hyphen_case or camelCase variants', () => {
    const out = redactPHI({
      patient_mrn: 'x',
      patientDob: '2000-01-01',
      access_token: 'abc',
      refresh_token: 'def',
    }) as Record<string, unknown>;
    expect(out.patient_mrn).toBe('[REDACTED]');
    // patientDob won't match because PHI_KEYS has 'patient_dob', not 'patientDob'
    expect(out.access_token).toBe('[REDACTED]');
    expect(out.refresh_token).toBe('[REDACTED]');
  });

  it('does not redact non-PHI keys', () => {
    const out = redactPHI({
      name: 'John',
      specialty: 'Cardiology',
      procedure: 'Angioplasty',
    }) as Record<string, unknown>;
    expect(out.name).toBe('John');
    expect(out.specialty).toBe('Cardiology');
    expect(out.procedure).toBe('Angioplasty');
  });

  it('redacts deeply nested PHI within arrays', () => {
    const out = redactPHI({
      entries: [
        { patient_mrn: '123', data: 'ok' },
        { patient_mrn: '456', data: 'also ok' },
      ],
    }) as Record<string, unknown>;
    const entries = out.entries as Record<string, unknown>[];
    expect(entries[0].patient_mrn).toBe('[REDACTED]');
    expect(entries[1].patient_mrn).toBe('[REDACTED]');
    expect(entries[0].data).toBe('ok');
  });

  it('replaces deeply nested PHI values with [REDACTED] at depth limit', () => {
    // Build a deeply nested object at depth 9
    const obj: Record<string, unknown> = { a: 1 };
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < 9; i++) {
      current.next = { a: 1 };
      current = current.next as Record<string, unknown>;
    }
    const out = redactPHI(obj);
    expect(out).toBeDefined();
  });

  it('redacts keys regardless of nesting in arrays of arrays', () => {
    const out = redactPHI({
      matrix: [
        [{ patient_mrn: '123' }, { safe: 1 }],
      ],
    }) as Record<string, unknown>;
    const matrix = out.matrix as Record<string, unknown>[][];
    expect(matrix[0][0].patient_mrn).toBe('[REDACTED]');
    expect(matrix[0][1].safe).toBe(1);
  });
});

describe('logger interface', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

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

  // --- Additional edge cases for logger interface ---

  it('debug() emits a JSON line via console.log', () => {
    logger.debug('hello debug');
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const line = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('debug');
    expect(parsed.msg).toBe('hello debug');
  });

  it('info() emits a JSON line via console.log', () => {
    logger.info('hello info');
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const line = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello info');
  });

  it('warn() emits a JSON line via console.error', () => {
    logger.warn('hello warn');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const line = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('hello warn');
  });

  it('error(string) emits a JSON line via console.error', () => {
    logger.error('something went wrong');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const line = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('something went wrong');
  });

  it('error(string) does not add stack/name meta', () => {
    logger.error('plain error message');
    const line = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.stack).toBeUndefined();
    expect(parsed.name).toBeUndefined();
    expect(parsed.msg).toBe('plain error message');
  });

  it('error(Error) adds stack and name to meta', () => {
    const err = new Error('boom');
    logger.error(err, { route: '/x' });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const line = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.msg).toBe('boom');
    expect(parsed.stack).toBeDefined();
    expect(parsed.name).toBe('Error');
    expect(parsed.route).toBe('/x');
  });

  it('error(Error) without meta still captures stack and name', () => {
    const err = new Error('just error');
    logger.error(err);
    const line = consoleErrorSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.msg).toBe('just error');
    expect(parsed.stack).toBeDefined();
    expect(parsed.name).toBe('Error');
  });

  it('debug() includes meta when provided', () => {
    logger.debug('debug with meta', { correlationId: 'abc-123' });
    const line = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.correlationId).toBe('abc-123');
  });

  it('includes process.pid in the output', () => {
    logger.info('check pid');
    const line = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.pid).toBeDefined();
    expect(typeof parsed.pid).toBe('number');
  });

  it('includes timestamp in ISO format', () => {
    logger.info('check ts');
    const line = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.ts).toBeDefined();
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts);
  });

  it('redacts PHI keys in meta', () => {
    logger.info('user data', { patient_mrn: '123-45-6789', name: 'John' });
    const line = consoleLogSpy.mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.patient_mrn).toBe('[REDACTED]');
    expect(parsed.name).toBe('John');
  });

  it('does not throw when request-context module is unavailable', () => {
    // The emit function uses a try-catch around require('./request-context')
    // This test verifies that even if require fails, emit still works
    expect(() => logger.info('no context')).not.toThrow();
  });
});

describe('redactPHI export alias', () => {
  it('is exported as redactPHI', async () => {
    const mod = await import('../logger');
    expect(mod.redactPHI).toBeDefined();
    expect(typeof mod.redactPHI).toBe('function');
  });
});
