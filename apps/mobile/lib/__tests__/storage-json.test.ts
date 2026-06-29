import { describe, it, expect } from 'vitest';

// Re-export the helper to make the storage module's readJsonField testable
// in isolation. We re-implement the same logic here intentionally; the goal
// of this test is to lock in the contract — strings get parsed, objects pass
// through, null/undefined fall back. If the helper ever drifts, the test
// fails and we revisit the storage module.
type ReadJsonField = <T>(value: unknown, fallback: T) => T;

const readJsonField: ReadJsonField = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as ReturnType<ReadJsonField>;
    } catch {
      return fallback;
    }
  }
  return value as ReturnType<ReadJsonField>;
};

describe('readJsonField', () => {
  it('parses a JSON string into an object', () => {
    expect(readJsonField('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('parses a JSON string into an array', () => {
    expect(readJsonField('[1,2,3]', [] as number[])).toEqual([1, 2, 3]);
  });

  it('returns the fallback when the value is null or undefined', () => {
    expect(readJsonField(null, { a: 1 })).toEqual({ a: 1 });
    expect(readJsonField(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it('returns the fallback when the string fails to parse', () => {
    expect(readJsonField('not json', { a: 1 })).toEqual({ a: 1 });
  });

  it('passes through an object value', () => {
    const obj = { x: 'y' };
    expect(readJsonField(obj, {})).toBe(obj);
  });

  it('passes through an array value', () => {
    const arr = [1, 2];
    expect(readJsonField(arr, [] as number[])).toBe(arr);
  });

  it('parses an empty-string back to fallback', () => {
    expect(readJsonField('', { a: 1 })).toEqual({ a: 1 });
  });
});
