import { describe, it, expect } from 'vitest';

function readJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

describe('readJsonField', () => {
  it('parses a JSON string into an object', () => {
    expect(readJsonField('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('parses a JSON string into an array', () => {
    expect(readJsonField<number[]>('[1,2,3]', [])).toEqual([1, 2, 3]);
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
    expect(readJsonField<number[]>(arr, [])).toBe(arr);
  });

  it('parses an empty-string back to fallback', () => {
    expect(readJsonField('', { a: 1 })).toEqual({ a: 1 });
  });
});
